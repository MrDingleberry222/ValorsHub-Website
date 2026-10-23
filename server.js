const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const si = require("systeminformation");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const DATA_DIR = path.join(process.env.APPDATA || os.homedir(), "ValorsHubWebsite");
const SESSION_TOKEN = crypto.randomBytes(32).toString("hex");
const LOCAL_ORIGIN = `http://${HOST}:${PORT}`;
const VALORSHUB_WEBSITE_URL = process.env.VALORSHUB_WEBSITE_URL || `http://${HOST}:4173`;
const MAX_BODY_BYTES = 64 * 1024;
const STORE_FILES = {
  "app-data": "app-data.json",
  "user-profile": "user-profile.json",
  "app-settings": "app-settings.json",
};

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(value));
}

function requestOriginIsLocal(request) {
  const origin = request.headers.origin;
  return !origin || origin === LOCAL_ORIGIN;
}

function requestHostIsLocal(request) {
  return request.headers.host === `${HOST}:${PORT}`;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body is too large"), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON"), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function parseJsonData(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null);
}

async function readSavedJson(name) {
  const file = path.join(DATA_DIR, name);
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeSavedJson(name, value) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, name);
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temp, parseJsonData(value), { encoding: "utf8", flag: "wx" });
  await fsp.rename(temp, file);
}

function appIsExcluded(name) {
  return /windowsapps|steamworks|redistributable|visual c\+\+|directx|setup|installer|uninstall|update|patch|support|helper|service|framework|runtime|library|sdk|toolkit|platform|common|shared/i.test(
    name,
  );
}

async function listDirectory(directory) {
  try {
    return await fsp.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM", "ENOTDIR"].includes(error.code)) {
      console.warn(`App discovery skipped ${directory}: ${error.message}`);
      return [];
    }
    throw error;
  }
}

async function discoverApps(existingApps) {
  if (!Array.isArray(existingApps) || existingApps.length > 500) {
    throw Object.assign(new Error("Existing apps must be an array of at most 500 items"), {
      status: 400,
    });
  }

  const existingNames = new Set(
    existingApps
      .map((app) => (typeof app?.name === "string" ? app.name.toLowerCase() : ""))
      .filter(Boolean),
  );
  const found = new Map();
  const add = (name, appPath) => {
    const normalizedName = name.trim();
    if (!normalizedName || appIsExcluded(normalizedName)) return;
    const key = normalizedName.toLowerCase();
    if (!existingNames.has(key) && !found.has(key)) {
      found.set(key, { name: normalizedName, path: appPath, icon: null });
    }
  };
  const allowedFile = (name) => /\.(?:lnk|url|exe)$/i.test(name);

  const shortcutFolders = [
    path.join(os.homedir(), "Desktop"),
    process.env.PUBLIC && path.join(process.env.PUBLIC, "Desktop"),
    process.env.APPDATA &&
      path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs"),
    process.env.ProgramData &&
      path.join(process.env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs"),
  ].filter(Boolean);

  for (const folder of shortcutFolders) {
    for (const entry of await listDirectory(folder)) {
      if (entry.isFile() && allowedFile(entry.name)) {
        add(entry.name.replace(/\.(?:lnk|url|exe)$/i, ""), path.join(folder, entry.name));
      }
    }
  }

  const programFolders = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs"),
  ].filter(Boolean);

  for (const folder of programFolders) {
    for (const entry of await listDirectory(folder)) {
      if (entry.isFile() && /\.exe$/i.test(entry.name)) {
        add(entry.name.replace(/\.exe$/i, ""), path.join(folder, entry.name));
      } else if (entry.isDirectory() && !appIsExcluded(entry.name)) {
        const appFolder = path.join(folder, entry.name);
        const executables = (await listDirectory(appFolder))
          .filter((file) => file.isFile() && /\.exe$/i.test(file.name) && !appIsExcluded(file.name))
          .slice(0, 3);
        const executable = executables.find((file) => !/unins|setup|update/i.test(file.name));
        if (executable) add(entry.name, path.join(appFolder, executable.name));
      }
      if (found.size >= 300) break;
    }
    if (found.size >= 300) break;
  }

  return [...found.values()].slice(0, 300);
}

async function ensureRequestedApps(savedApps) {
  if (savedApps !== null && !Array.isArray(savedApps)) {
    throw new Error("Saved apps must be an array");
  }
  const apps = savedApps || [];
  const requestedApps = [
    {
      name: "ValorsHub",
      path: VALORSHUB_WEBSITE_URL,
    },
    {
      name: "Discord",
      path: "https://discord.com/app",
    },
  ];

  for (const requested of requestedApps) {
    const app = apps.find(
      (entry) =>
        typeof entry?.name === "string" &&
        entry.name.toLowerCase() === requested.name.toLowerCase(),
    );
    if (app) {
      app.path = requested.path;
      app.isWebsite = true;
      continue;
    }
    apps.push({
      name: requested.name,
      customName: requested.name,
      path: requested.path,
      isWebsite: true,
      description: "",
      icon: null,
      themeColor: "#0a0a0a",
      section: "all",
      id: crypto.randomUUID(),
      favorite: false,
      playtimeMs: 0,
      selectedIcon: "original",
      customIcon: null,
      lastUsed: null,
      launchCount: 0,
      originalIcon: null,
    });
  }

  return apps;
}

function launchProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      shell: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

async function launchApp(appPath) {
  if (typeof appPath !== "string" || appPath.length > 4096 || /[\0\r\n]/.test(appPath)) {
    throw Object.assign(new Error("Invalid application path"), { status: 400 });
  }
  const target = appPath.trim();
  if (!target || target !== appPath) {
    throw Object.assign(new Error("Application path is empty or contains surrounding whitespace"), {
      status: 400,
    });
  }

  if (/^(?:https?|steam|com\.epicgames\.launcher|uplay|battlenet|roblox-player|roblox|ms-windows-store|xbox|goggalaxy|eaapp):\/\//i.test(target)) {
    const scheme = target.slice(0, target.indexOf(":")).toLowerCase();
    if (scheme === "http" || scheme === "https") {
      const url = new URL(target);
      if (url.username || url.password) {
        throw Object.assign(new Error("URLs with embedded credentials cannot be launched"), {
          status: 400,
        });
      }
    }
    return launchProcess("explorer.exe", [target]);
  }

  if (/^shell:AppsFolder\\[A-Za-z0-9!._-]+$/i.test(target)) {
    return launchProcess("explorer.exe", [target]);
  }

  if (!path.isAbsolute(target) || !/\.(?:exe|lnk|url)$/i.test(target)) {
    throw Object.assign(
      new Error("Only absolute .exe, .lnk, and .url paths can be launched from the website"),
      { status: 400 },
    );
  }
  const file = await fsp.stat(target).catch((error) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      throw Object.assign(new Error("The selected application path does not exist"), { status: 404 });
    }
    throw error;
  });
  if (!file.isFile()) {
    throw Object.assign(new Error("The selected application path is not a file"), { status: 400 });
  }
  if (/\.(?:lnk|url)$/i.test(target)) return launchProcess("explorer.exe", [target]);
  return launchProcess(target, []);
}

async function getSystemStats() {
  const [load, disks] = await Promise.all([si.currentLoad(), si.fsSize()]);
  const total = os.totalmem();
  const free = os.freemem();
  const drive = process.env.SystemDrive?.toLowerCase();
  const disk =
    disks.find((entry) => entry.mount.toLowerCase() === drive) ||
    disks.find((entry) => entry.mount.toLowerCase() === "c:") ||
    disks[0];
  return {
    cpu: Math.round(load.currentLoad || 0),
    ram: total ? Math.round(((total - free) / total) * 100) : 0,
    storage: disk?.size ? Math.round((disk.used / disk.size) * 100) : 0,
    ramUsedGb: (total - free) / 1024 ** 3,
    ramTotalGb: total / 1024 ** 3,
    storageUsedGb: disk ? disk.used / 1024 ** 3 : 0,
    storageTotalGb: disk ? disk.size / 1024 ** 3 : 0,
  };
}

async function getNetworkAdapter() {
  const [defaultName, interfaces] = await Promise.all([
    si.networkInterfaceDefault(),
    si.networkInterfaces(),
  ]);
  const all = Array.isArray(interfaces) ? interfaces : [interfaces];
  const iface =
    all.find((entry) => entry.iface === defaultName) ||
    all.find((entry) => entry.default) ||
    all.find((entry) => entry.operstate === "up" && !entry.internal);
  if (!iface) return null;
  let wifi = null;
  if (iface.type === "wireless") {
    const connections = await si.wifiConnections();
    wifi = connections.find((entry) => entry.iface === iface.iface) || connections[0] || null;
  }
  return {
    name: iface.ifaceName || iface.iface,
    type: iface.type || null,
    linkSpeed: iface.speed || null,
    ssid: wifi?.ssid || null,
    signal: wifi?.signalLevel ?? null,
    quality: wifi?.quality ?? null,
    frequency: wifi?.frequency ?? null,
    channel: wifi?.channel ?? null,
  };
}

async function getDeviceKey() {
  const file = path.join(DATA_DIR, "device-id");
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    return (await fsp.readFile(file, "utf8")).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const key = crypto.randomUUID();
  try {
    await fsp.writeFile(file, key, { encoding: "utf8", flag: "wx" });
    return key;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return (await fsp.readFile(file, "utf8")).trim();
  }
}

async function handleIpc(channel, args) {
  if (!Array.isArray(args)) {
    throw Object.assign(new Error("IPC arguments must be an array"), { status: 400 });
  }

  if (channel === "discover-apps") {
    return { events: [{ channel: "apps-discovered", payload: await discoverApps(args[0] || []) }] };
  }
  if (channel === "launch-app") {
    await launchApp(args[0]);
    return { events: [{ channel: "app-launched", payload: true }] };
  }
  if (channel === "get-system-stats") {
    return { events: [{ channel: "system-stats", payload: await getSystemStats() }] };
  }
  if (channel === "get-network-adapter") return { value: await getNetworkAdapter() };
  if (channel === "net-probe") return { value: null };
  if (channel === "net-probe-stop") return { value: true };
  if (channel === "system-idle-seconds") return { value: null };
  if (channel === "gpu-status") {
    return { value: { enabled: true, crashedLastRun: false, setting: true } };
  }
  if (channel === "update-get-state" || channel === "update-check") {
    return {
      value: {
        supported: false,
        status: "unsupported",
        currentVersion: "1.161.0",
        availableVersion: null,
        percent: 0,
        error: "Website updates are managed by replacing the website folder.",
      },
    };
  }
  if (channel === "update-install") return { value: false };
  if (channel === "playtime-set-library" || channel === "playtime-ack") {
    return { value: true };
  }
  if (channel === "playtime-state") {
    return { value: { supported: false, running: [], pending: [] } };
  }
  if (channel === "device-info") {
    return {
      value: {
        deviceKey: await getDeviceKey(),
        name: os.hostname() || "My PC",
        platform: process.platform === "win32" ? "windows" : process.platform,
        appVersion: "1.161.0",
      },
    };
  }
  if (channel === "games-art") return { value: {} };
  if (channel.startsWith("overlay-")) {
    const isUserAction = ["overlay-command", "overlay-notify", "overlay-preview"].includes(channel);
    return {
      value: false,
      events: isUserAction
        ? [
            {
              channel: "native-feature-unavailable",
              payload: "The desktop overlay is not available in a browser website.",
            },
          ]
        : [],
    };
  }
  if (channel === "games-scan") {
    throw Object.assign(new Error("The desktop game scanner is not available in website mode"), {
      status: 501,
    });
  }
  if (channel === "get-screen-sources") return { value: [] };
  if (channel === "select-screen-source") return { value: false };
  if (channel === "discord-presence-status") {
    return { value: { configured: false, connected: false } };
  }
  if (channel === "take-deep-link" || channel === "ios-icon-lookup") {
    return { value: null };
  }
  if (channel === "open-app-folder") {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await launchProcess("explorer.exe", [DATA_DIR]);
    return { value: true };
  }
  if (channel === "get-app-icon") {
    return { events: [{ channel: "app-icon", payload: null }] };
  }
  if (channel === "get-assets-path") {
    return { events: [{ channel: "assets-path", payload: "/app-assets" }] };
  }

  for (const [key, file] of Object.entries(STORE_FILES)) {
    if (channel === `load-${key}`) {
      let value = await readSavedJson(file);
      if (key === "app-data") {
        const original = JSON.stringify(value);
        const apps = await ensureRequestedApps(value);
        if (JSON.stringify(apps) !== original) {
          await writeSavedJson(file, apps);
        }
        value = apps;
      }
      return { events: [{ channel: `${key}-loaded`, payload: value }] };
    }
    if (channel === `save-${key}`) {
      await writeSavedJson(file, args[0]);
      return { events: [{ channel: `${key}-saved`, payload: true }] };
    }
  }

  const unsupportedSettings = {
    "toggle-launch-on-startup": "launch-on-startup-toggled",
    "toggle-tray": "tray-toggled",
    "toggle-hardware-acceleration": "hardware-acceleration-toggled",
  };
  if (unsupportedSettings[channel]) {
    return {
      events: [
        { channel: unsupportedSettings[channel], payload: false },
        ...(args[0] === true
          ? [
              {
                channel: "native-feature-unavailable",
                payload: "This desktop-only setting cannot be changed from a browser website.",
              },
            ]
          : []),
      ],
    };
  }
  if (channel === "discord-presence" || channel === "discord-presence-enabled") {
    return { value: false };
  }
  if (channel === "ui-ready" || channel === "open-settings") return { value: true };

  throw Object.assign(new Error(`Unsupported desktop operation: ${channel}`), { status: 501 });
}

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

async function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }
  if (
    pathname !== "/" &&
    pathname !== "/index.html" &&
    pathname !== "/bridge.js" &&
    !pathname.startsWith("/assets/") &&
    !pathname.startsWith("/app-assets/")
  ) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    sendJson(response, 400, { error: "Malformed URL path" });
    return;
  }
  const file = path.resolve(ROOT, `.${decoded}`);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control":
        pathname === "/" || pathname === "/index.html" || pathname === "/bridge.js"
          ? "no-store"
          : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self' https: data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self' data:; connect-src 'self' https: wss:; media-src 'self' https: blob:; frame-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    fs.createReadStream(file).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    console.error(`Failed to serve ${pathname}:`, error);
    sendJson(response, 500, { error: "Failed to serve website asset" });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (!requestHostIsLocal(request) || !requestOriginIsLocal(request)) {
      sendJson(response, 403, { error: "Requests must come from the local ValorsHub website" });
      return;
    }
    const url = new URL(request.url, LOCAL_ORIGIN);
    if (url.pathname === "/api/session" && request.method === "GET") {
      sendJson(response, 200, { token: SESSION_TOKEN });
      return;
    }
    if (url.pathname === "/api/ipc") {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }
      if (request.headers.origin !== LOCAL_ORIGIN) {
        sendJson(response, 403, { error: "A local website origin is required" });
        return;
      }
      if (request.headers["x-valorshub-token"] !== SESSION_TOKEN) {
        sendJson(response, 403, { error: "Invalid local session token" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await handleIpc(body.channel, body.args);
      sendJson(response, 200, result);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    await serveStatic(request, response, url.pathname);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error("Local companion request failed:", error);
    sendJson(response, status, { error: error.message || "Local companion request failed" });
  }
});

server.on("error", (error) => {
  console.error("Could not start the ValorsHub website companion:", error);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`ValorsHub website running at ${LOCAL_ORIGIN}`);
  console.log("The companion listens on this PC only; keep this terminal open while using the site.");
});

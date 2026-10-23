const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const ROOT = __dirname;
const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const ALLOWED_ROOT_FILES = new Set(["index.html", "bridge.js"]);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

function sendText(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(body);
}

async function serveFile(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  if (pathname === "/health") {
    sendText(response, 200, "ok");
    return;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    sendText(response, 400, "Malformed URL path");
    return;
  }

  const relativePath = decoded.replace(/^[/\\]+/, "");
  const segments = relativePath.split(/[\\/]/);
  const isAllowed =
    (segments.length === 1 && ALLOWED_ROOT_FILES.has(segments[0])) ||
    (segments[0] === "assets" && segments.length > 1) ||
    (segments[0] === "app-assets" && segments.length > 1);
  if (!isAllowed || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    sendText(response, 404, "Not found");
    return;
  }

  const file = path.resolve(ROOT, relativePath);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) {
    sendText(response, 404, "Not found");
    return;
  }

  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }

    const contentType =
      MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    const headers = {
      "Content-Type": contentType,
      "Cache-Control":
        pathname === "/" ||
        pathname === "/index.html" ||
        pathname === "/bridge.js" ||
        pathname === "/assets/index-BdKSPUcR.js" ||
        pathname === "/assets/App-B9Cuvou9.js"
          ? "no-store"
          : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self' https: data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self' data:; connect-src 'self' https: wss:; media-src 'self' https: blob:; frame-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    };
    response.writeHead(200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    if (pathname === "/bridge.js") {
      response.write("window.__VALORSHUB_HOSTED__ = true;\n");
      fs.createReadStream(file).pipe(response);
      return;
    }
    fs.createReadStream(file).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      sendText(response, 404, "Not found");
      return;
    }
    console.error(`Failed to serve ${pathname}:`, error);
    sendText(response, 500, "Failed to serve website asset");
  }
}

const server = http.createServer(async (request, response) => {
  let url;
  try {
    url = new URL(request.url, `http://${HOST}:${PORT}`);
  } catch {
    sendText(response, 400, "Invalid request URL");
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendText(response, 404, "The local Windows companion is not available on Railway");
    return;
  }
  try {
    await serveFile(request, response, url.pathname);
  } catch (error) {
    console.error(`Failed to process ${url.pathname}:`, error);
    if (!response.headersSent) {
      sendText(response, 500, "Failed to serve website asset");
      return;
    }
    response.destroy(error);
  }
});

server.on("error", (error) => {
  console.error("Could not start the ValorsHub Railway website:", error);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`ValorsHub website listening on port ${PORT}`);
});

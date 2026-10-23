(() => {
  window.__VALORSHUB_WEB__ = true;
  const isHostedDeployment = window.__VALORSHUB_HOSTED__ === true;
  const listeners = new Map();
  let tokenPromise;
  let windowMode = "windowed";
  const hostedStores = new Set(["app-data", "user-profile", "app-settings"]);

  function loadHostedStore(key) {
    const serialized = localStorage.getItem(`valorshub-website:${key}`);
    if (serialized === null) return null;
    return JSON.parse(serialized);
  }

  function saveHostedStore(key, value) {
    if (key === "app-data" && (!Array.isArray(value) || value.length > 500)) {
      throw new Error("App library must be an array of at most 500 apps.");
    }
    localStorage.setItem(`valorshub-website:${key}`, JSON.stringify(value ?? null));
  }

  function ensureHostedApps(value) {
    const apps = value === null ? [] : value;
    if (!Array.isArray(apps)) throw new Error("Saved app library is not valid.");

    const requestedApps = [
      { name: "ValorsHub", path: `${window.location.origin}/` },
      { name: "Discord", path: "https://discord.com/app" },
    ];
    for (const requested of requestedApps) {
      const existing = apps.find(
        (app) =>
          app &&
          typeof app.name === "string" &&
          app.name.toLowerCase() === requested.name.toLowerCase(),
      );
      if (existing) {
        existing.path = requested.path;
        existing.isWebsite = true;
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
        id: `website-${requested.name.toLowerCase()}`,
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

  function handleHostedRequest(channel, args) {
    for (const key of hostedStores) {
      if (channel === `load-${key}`) {
        const loaded = loadHostedStore(key);
        const original = key === "app-data" ? JSON.stringify(loaded) : null;
        const value = key === "app-data" ? ensureHostedApps(loaded) : loaded;
        if (key === "app-data" && JSON.stringify(value) !== original) {
          saveHostedStore(key, value);
        }
        return { events: [{ channel: `${key}-loaded`, payload: value }] };
      }
      if (channel === `save-${key}`) {
        saveHostedStore(key, args[0]);
        return { events: [{ channel: `${key}-saved`, payload: true }] };
      }
    }

    if (channel === "discover-apps") {
      return { events: [{ channel: "apps-discovered", payload: [] }] };
    }
    if (channel === "get-system-stats") {
      return {
        events: [
          {
            channel: "system-stats",
            payload: { unavailable: true, error: "Hardware stats are only available on your PC." },
          },
        ],
      };
    }
    if (channel === "get-app-icon") {
      return { events: [{ channel: "app-icon", payload: null }] };
    }
    if (channel === "get-assets-path") {
      return { events: [{ channel: "assets-path", payload: "/app-assets" }] };
    }
    if (channel === "games-scan") {
      return {
        events: [
          {
            channel: "native-feature-unavailable",
            payload: "The game scanner is available only in the desktop app on your PC.",
          },
        ],
      };
    }
    if (channel.startsWith("overlay-")) {
      return {
        value: false,
        events:
          channel === "overlay-command" || channel === "overlay-notify" || channel === "overlay-preview"
            ? [
                {
                  channel: "native-feature-unavailable",
                  payload: "The desktop overlay is only available in the desktop app.",
                },
              ]
            : [],
      };
    }

    if (channel === "device-info") {
      let deviceKey = localStorage.getItem("valorshub-website:device-id");
      if (!deviceKey) {
        deviceKey = crypto.randomUUID();
        localStorage.setItem("valorshub-website:device-id", deviceKey);
      }
      return {
        value: {
          deviceKey,
          name: "Web browser",
          platform: "web",
          appVersion: "1.161.0",
        },
      };
    }
    if (channel === "get-network-adapter" || channel === "take-deep-link" || channel === "ios-icon-lookup") {
      return { value: null };
    }
    if (channel === "net-probe-stop" || channel === "ui-ready" || channel === "open-settings") {
      return { value: true };
    }
    if (channel === "net-probe" || channel === "system-idle-seconds") return { value: null };
    if (channel === "playtime-set-library" || channel === "playtime-ack") {
      return { value: true };
    }
    if (channel === "playtime-state") {
      return { value: { supported: false, running: [], pending: [] } };
    }
    if (channel === "games-art") return { value: {} };
    if (channel === "gpu-status") {
      return { value: { enabled: false, crashedLastRun: false, setting: false } };
    }
    if (channel === "get-screen-sources") return { value: [] };
    if (channel === "select-screen-source" || channel === "update-install") {
      return { value: false };
    }
    if (channel === "discord-presence-status") {
      return { value: { configured: false, connected: false } };
    }
    if (channel === "discord-presence" || channel === "discord-presence-enabled") {
      return { value: false };
    }
    if (channel === "update-get-state" || channel === "update-check") {
      return {
        value: {
          supported: false,
          status: "unsupported",
          currentVersion: "1.161.0",
          availableVersion: null,
          percent: 0,
          error: "Website updates are managed by replacing the website on Railway.",
        },
      };
    }
    if (
      channel === "toggle-launch-on-startup" ||
      channel === "toggle-tray" ||
      channel === "toggle-hardware-acceleration"
    ) {
      const eventChannels = {
        "toggle-launch-on-startup": "launch-on-startup-toggled",
        "toggle-tray": "tray-toggled",
        "toggle-hardware-acceleration": "hardware-acceleration-toggled",
      };
      return {
        events: [
          { channel: eventChannels[channel], payload: false },
          ...(args[0] === true
            ? [
                {
                  channel: "native-feature-unavailable",
                  payload: "This setting is available only in the desktop app on your PC.",
                },
              ]
            : []),
        ],
      };
    }
    if (channel === "window-mode-get") return { value: windowMode };
    if (channel === "window-mode-set") {
      windowMode = args[0] === "windowed" ? "windowed" : "fullscreen";
      emit("window-mode", windowMode);
      return { value: windowMode };
    }

    throw new Error(`Unsupported hosted website operation: ${channel}`);
  }

  function emit(channel, payload) {
    if (channel === "native-feature-unavailable") {
      notify(String(payload || "This desktop-only feature is unavailable in the browser website."));
    }
    for (const listener of listeners.get(channel) || []) {
      try {
        listener({ sender: null }, payload);
      } catch (error) {
        console.error(`ValorsHub listener failed for ${channel}:`, error);
      }
    }
  }

  function notify(message, isError = false) {
    let notice = document.getElementById("valorshub-local-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "valorshub-local-notice";
      Object.assign(notice.style, {
        position: "fixed",
        top: "14px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: "2147483647",
        maxWidth: "min(640px, calc(100vw - 28px))",
        padding: "12px 16px",
        borderRadius: "10px",
        color: "#fff",
        background: "#252833",
        border: "1px solid #555a6c",
        boxShadow: "0 8px 32px #0008",
        font: "14px/1.45 system-ui, sans-serif",
      });
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      document.body.appendChild(notice);
    }
    notice.style.borderColor = isError ? "#d95d65" : "#555a6c";
    notice.textContent = message;
    notice.hidden = false;
    clearTimeout(notice.hideTimer);
    notice.hideTimer = setTimeout(() => {
      notice.hidden = true;
    }, 6000);
  }

  function getWebsiteAppUrl(value) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      if (
        url.origin === window.location.origin &&
        (url.pathname === "/" || url.pathname === "/index.html")
      ) {
        return url;
      }
      if (
        url.protocol === "https:" &&
        url.hostname === "discord.com" &&
        url.pathname === "/app"
      ) {
        return url;
      }
    } catch {
      return null;
    }
    return null;
  }

  function showWebsiteApp(name, url) {
    document.getElementById("valorshub-website-app")?.closeViewer();

    const overlay = document.createElement("section");
    overlay.id = "valorshub-website-app";
    overlay.setAttribute("aria-label", `${name} website`);
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      display: "flex",
      flexDirection: "column",
      background: "#09090b",
      color: "#fff",
      font: "14px/1.45 system-ui, sans-serif",
    });

    const header = document.createElement("header");
    Object.assign(header.style, {
      minHeight: "52px",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      padding: "0 16px",
      borderBottom: "1px solid #ffffff1a",
      background: "#111113",
    });

    const title = document.createElement("strong");
    title.textContent = name;
    title.style.flex = "1";

    const fallback = document.createElement("button");
    fallback.type = "button";
    fallback.textContent = "Open in this tab";
    fallback.title = "Use this tab if the website does not allow embedding";
    fallback.hidden = url.origin === window.location.origin;

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Back to ValorsHub";

    for (const button of [fallback, close]) {
      Object.assign(button.style, {
        padding: "8px 12px",
        border: "1px solid #ffffff30",
        borderRadius: "8px",
        background: "#ffffff12",
        color: "#fff",
        cursor: "pointer",
        font: "inherit",
      });
    }

    const frame = document.createElement("iframe");
    frame.title = `${name} website`;
    frame.src = url.href;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow = "clipboard-read; clipboard-write; microphone; camera";
    Object.assign(frame.style, {
      flex: "1",
      width: "100%",
      border: "0",
      background: "#09090b",
    });

    const closeViewer = () => {
      window.removeEventListener("keydown", onKeydown);
      frame.src = "about:blank";
      overlay.remove();
    };
    overlay.closeViewer = closeViewer;
    const onKeydown = (event) => {
      if (event.key === "Escape") closeViewer();
    };
    let note = null;
    if (name === "Discord") {
      note = document.createElement("p");
      note.textContent =
        "If Discord appears blank, it may be blocking embedded views. Use “Open in this tab” to continue.";
      Object.assign(note.style, {
        margin: "0",
        padding: "8px 16px",
        color: "#b9bac2",
        background: "#111113",
        fontSize: "12px",
      });
    }
    fallback.addEventListener("click", () => window.location.assign(url.href));
    close.addEventListener("click", closeViewer);
    window.addEventListener("keydown", onKeydown);

    header.append(title, fallback, close);
    overlay.append(header);
    if (note) overlay.append(note);
    overlay.append(frame);
    document.body.append(overlay);
  }

  function getToken() {
    if (!tokenPromise) {
      tokenPromise = fetch("/api/session", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Companion returned HTTP ${response.status}`);
          const session = await response.json();
          if (typeof session.token !== "string" || !session.token) {
            throw new Error("Companion did not issue a session token");
          }
          return session.token;
        })
        .catch((error) => {
          tokenPromise = null;
          throw error;
        });
    }
    return tokenPromise;
  }

  async function request(channel, args) {
    const token = await getToken();
    const response = await fetch("/api/ipc", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-ValorsHub-Token": token,
      },
      body: JSON.stringify({ channel, args }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Companion returned HTTP ${response.status}`);
    }
    return result;
  }

  function onRequestFailure(channel, error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ValorsHub companion request failed (${channel}):`, error);
    if (channel === "launch-app") emit("launch-error", message);
    if (channel === "get-system-stats") emit("system-stats", { error: message });
    notify(`Local companion error: ${message}`, true);
    window.dispatchEvent(
      new CustomEvent("valorshub:companion-error", { detail: { channel, message } }),
    );
  }

  const ipcRenderer = {
    sendSync(channel, ...args) {
      const key = args[0];
      if (channel === "get-storage-item") return localStorage.getItem(String(key));
      if (channel === "set-storage-item") {
        localStorage.setItem(String(key), String(args[1] ?? ""));
        return true;
      }
      if (channel === "remove-storage-item") {
        localStorage.removeItem(String(key));
        return true;
      }
      console.error(`Synchronous desktop operation is unavailable in website mode: ${channel}`);
      return null;
    },

    send(channel, ...args) {
      if (channel === "launch-app") {
        const url = getWebsiteAppUrl(args[0]);
        if (url) {
          showWebsiteApp(
            url.hostname === "discord.com" ? "Discord" : "ValorsHub",
            url,
          );
          return;
        }
        if (isHostedDeployment) {
          const message = "Desktop apps can only be launched from the ValorsHub app on your PC.";
          emit("launch-error", message);
          notify(message, true);
          return;
        }
      }
      if (channel === "browse-for-file" && isHostedDeployment) {
        emit("file-selected", null);
        notify("Choosing files from your PC is only available when running ValorsHub locally.");
        return;
      }
      if (channel === "browse-for-file") {
        const selected = window.prompt(
          "Enter the full path to an application (.exe, .lnk, or .url):",
        );
        emit("file-selected", selected?.trim() || null);
        return;
      }
      if (channel === "ui-ready") return;
      if (channel === "minimize-window") {
        window.blur();
        return;
      }
      if (channel === "maximize-window") {
        const action = document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen();
        action.catch((error) => notify(`Browser could not change window mode: ${error.message}`, true));
        return;
      }
      if (channel === "close-window") {
        window.close();
        setTimeout(() => notify("Close this browser tab to exit."), 0);
        return;
      }
      if (channel === "relaunch-app") {
        window.location.reload();
        return;
      }
      if (channel === "discord-presence") return;
      if (channel === "discord-presence-enabled") {
        if (args[0] === true && navigator.userActivation?.isActive) {
          notify("Discord Rich Presence requires the desktop app.");
        }
        return;
      }

      if (isHostedDeployment) {
        try {
          const { events = [] } = handleHostedRequest(channel, args);
          for (const event of events) emit(event.channel, event.payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Hosted website operation failed (${channel}):`, error);
          notify(`Website operation failed: ${message}`, true);
          window.dispatchEvent(
            new CustomEvent("valorshub:companion-error", { detail: { channel, message } }),
          );
        }
        return;
      }

      request(channel, args)
        .then(({ events = [] }) => {
          for (const event of events) emit(event.channel, event.payload);
        })
        .catch((error) => onRequestFailure(channel, error));
    },

    invoke(channel, ...args) {
      if (channel === "window-mode-get") return Promise.resolve(windowMode);
      if (channel === "window-mode-set") {
        const mode = args[0] === "windowed" ? "windowed" : "fullscreen";
        const operation =
          mode === "fullscreen"
            ? document.documentElement.requestFullscreen()
            : document.fullscreenElement
              ? document.exitFullscreen()
              : Promise.resolve();
        return operation
          .then(() => {
            windowMode = document.fullscreenElement ? "fullscreen" : "windowed";
            emit("window-mode", windowMode);
            return windowMode;
          })
          .catch((error) => {
            notify(`Browser could not change window mode: ${error.message}`, true);
            throw error;
          });
      }
      if (isHostedDeployment) {
        return Promise.resolve()
          .then(() => {
            const { value, events = [] } = handleHostedRequest(channel, args);
            for (const event of events) emit(event.channel, event.payload);
            return value;
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Hosted website operation failed (${channel}):`, error);
            notify(`Website operation failed: ${message}`, true);
            throw error;
          });
      }
      return request(channel, args)
        .then(({ value, events = [] }) => {
          for (const event of events) emit(event.channel, event.payload);
          return value;
        })
        .catch((error) => {
          onRequestFailure(channel, error);
          throw error;
        });
    },

    on(channel, listener) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(listener);
      return ipcRenderer;
    },

    once(channel, listener) {
      const wrapped = (event, payload) => {
        ipcRenderer.removeListener(channel, wrapped);
        listener(event, payload);
      };
      return ipcRenderer.on(channel, wrapped);
    },

    removeListener(channel, listener) {
      listeners.get(channel)?.delete(listener);
      return ipcRenderer;
    },

    off(channel, listener) {
      return ipcRenderer.removeListener(channel, listener);
    },

    removeAllListeners(channel) {
      if (channel) listeners.delete(channel);
      else listeners.clear();
      return ipcRenderer;
    },
  };

  window.require = (moduleName) => {
    if (moduleName !== "electron") {
      throw new Error(`The website companion does not provide Node module: ${moduleName}`);
    }
    return { ipcRenderer };
  };

  window.addEventListener("focus", () => emit("window-focused"));
  window.addEventListener("fullscreenchange", () => {
    windowMode = document.fullscreenElement ? "fullscreen" : "windowed";
    emit("window-mode", windowMode);
  });
})();

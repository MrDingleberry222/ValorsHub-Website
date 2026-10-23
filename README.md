# ValorsHub Website

This folder contains a browser version of the ValorsHub interface, an optional Windows companion for local-machine features, and a static-only Railway deployment mode.

## Original Creator:
Valor (valortheplug: 1185991173958008843)
https://discord.gg/trNgGFTv88

## Start

1. Install Node.js 18 or newer.
2. In this folder, run `npm install` once.
3. Run `npm start`.
4. Open the printed `http://127.0.0.1:4173` address in your browser.

Keep the terminal running while you use the site. Set `PORT` to use another local port. This local mode includes the Windows companion, which can launch applications and access local machine features.

## Deploy to Railway

1. Create an empty GitHub repository and push this folder's files to it. Do not upload `node_modules` or `.env` files.
2. In Railway, choose **New Project → Deploy from GitHub repo**, select the repository, and let Railway use the included `railway.json`.
3. After deployment, generate a public domain in the Railway service's **Settings → Networking**.
4. Add the hosted website origin (including `https://`) to the allowed redirect URLs in the ValorsHub auth provider.

Railway runs the static-only `start:railway` server. It never exposes the Windows companion API; desktop application launching, hardware statistics, game scanning, and other PC-only features remain local-only. The hosted app library is saved in that visitor's browser. Railway's local storage is temporary, so use a database if app data must sync between browsers or devices. Discord may block embedding and can be opened in the same tab from its in-app viewer.

## Local companion

The companion binds only to `127.0.0.1`. It serves the website, checks a per-run token and same-origin requests, and permits launching only local `.exe`, `.lnk`, `.url` files or recognized launcher URLs. It does not accept shell commands or executable arguments. App discovery scans common Windows Desktop, Start Menu, and Program Files folders.

The website can persist app data, read hardware/network information, discover common installed apps, and launch discovered or manually entered app paths. Its ValorsHub and Discord library cards open the local ValorsHub website and Discord web client in an in-app viewer instead of launching desktop apps or opening a new tab. Discord may block embedding; use "Open in this tab" if needed. Set `VALORSHUB_WEBSITE_URL` if the local website uses a different address than `http://127.0.0.1:4173`. The desktop game scanner/playtime tracker, floating overlay, self-updater, tray/startup integration, hardware-acceleration controls, and Discord Rich Presence remain desktop-only. File picking is replaced with a prompt for an application path.

Cloud sign-in uses ValorsHub's existing auth configuration. Browser OAuth and signup-confirmation links return to the current website origin; allow that origin (for example, `http://127.0.0.1:4173`) as a redirect URL in the auth provider. The desktop app continues to use its `valorshub://` callback.

import { app, BrowserWindow, Menu, session, Tray, nativeImage, shell } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import path from "node:path";
import { DASHBOARD_URL } from "./config.js";

// PRD 7: "Windows desktop app: wrapper loading the live dashboard, tray icon, optional start-at-login, system
// notifications for new leads/handoffs, code-signed installer, auto-update, download page with install
// instructions." This is that wrapper -- it owns none of the actual product logic (auth, data, notifications
// content), it just hosts the real dashboard's own pages in a native window with tray/login-item/auto-update
// behavior a browser tab can't offer. Desktop notifications for new leads/handoffs are the dashboard's own
// existing alert poll (lib/alerts.ts) firing a standard Notification API call -- nothing Electron-specific
// lives in the dashboard for that, it's the same code a real browser tab would run.

let mainWindow = null;
let tray = null;
let quitting = false;
function iconPath(name) {
  // Packaged (electron-builder extraResources-free layout): build/ sits next to the app root either way, since
  // electron-builder copies "build/" assets alongside app.asar by default for icon resolution.
  return path.join(app.getAppPath(), "..", "build", name);
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "Enrollium",
    icon: nativeImage.createFromPath(iconPath("icon.png")),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });
  void mainWindow.loadURL(DASHBOARD_URL);
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Close = minimize to tray, not quit -- the whole point of the tray icon is staying reachable for
  // notifications without a window cluttering the taskbar. Tray menu's "Quit Enrollium" is the real exit.
  mainWindow.on("close", e => {
    if (quitting) return;
    e.preventDefault();
    mainWindow?.hide();
  });

  // Links the dashboard opens with target="_blank" (e.g. "Meta's setup guide" in Settings > Channels) go to
  // the system browser, not a second app window.
  mainWindow.webContents.setWindowOpenHandler(({
    url
  }) => {
    void shell.openExternal(url);
    return {
      action: "deny"
    };
  });
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath("tray-icon.png")));
  tray.setToolTip("Enrollium");
  const rebuildMenu = () => {
    tray.setContextMenu(Menu.buildFromTemplate([{
      label: "Open Enrollium",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    }, {
      type: "separator"
    }, {
      label: "Start at login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({
        openAtLogin: item.checked
      })
    }, {
      type: "separator"
    }, {
      label: "Quit Enrollium",
      click: () => {
        quitting = true;
        app.quit();
      }
    }]));
  };
  rebuildMenu();
  tray.on("click", () => {
    mainWindow?.isVisible() ? mainWindow?.hide() : (mainWindow?.show(), mainWindow?.focus());
  });
}
app.whenReady().then(() => {
  // Desktop notifications for new leads/handoffs (see the top-of-file note) need this origin allowed to show
  // them at all -- a browser tab would prompt the staff member instead; the app's own window can just grant it,
  // since it's this app's whole purpose, not an arbitrary site asking.
  const dashboardOrigin = new URL(DASHBOARD_URL).origin;
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "notifications"));
  ses.setPermissionCheckHandler((_wc, permission, origin) => permission === "notifications" && origin === dashboardOrigin);
  createWindow();
  createTray();

  // Auto-update (PRD 7): reads latest.yml from this repo's GitHub Releases. A no-op with a clear log line until
  // a signed release actually exists there -- never throws, since a failed update check must never block the
  // app opening.
  autoUpdater.checkForUpdatesAndNotify().catch(err => console.error("update check failed:", err instanceof Error ? err.message : err));
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();else mainWindow?.show();
  });
});
app.on("before-quit", () => {
  quitting = true;
});
// Windows/Linux: closing the last window normally quits; here it doesn't, because "close" above hides instead
// of destroying the window, so this handler in practice only ever fires on an explicit tray "Quit".
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && quitting) app.quit();
});
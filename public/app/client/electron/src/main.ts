process.env.IS_ELECTRON = "1";

import {initFileLogger, log} from "@core/lib/utils/logger";
import { inspect } from "util";
import { app, screen, BrowserWindow, dialog, Menu, MenuItem } from "electron";
import { Client } from "../../../core/src/types";
import { getCoreProcAuthToken } from "@core/lib/client_store/key_store";
import { startCoreFromElectron, stopCoreProcess } from "./core_proc";
import { terminateWorkerPool } from "@core/lib/crypto";
import path from "path";
import { runAppUpdate } from "./app_updates";
import { downloadAndInstallCli, isCliInstalled } from "./cli_updates";

let appReady = false;
let win: BrowserWindow | undefined;
let authToken: string | undefined;

let appWillAutoExit = false;

// When the core process is started outside this desktop app, logs written
// from the desktop app don't work because the log file stream is already
// held open by the core process.
initFileLogger("desktop");

app.on("ready", () => {
  log("on:ready", { version: app.getVersion() });
  setupAppUpdateMenu();

  runAppUpdate(() => {
    appWillAutoExit = true;
  });

  startCoreFromElectron()
    .then(() => {
      log("core started from electron", {
        currentAppVersion: app.getVersion(),
      });
      return getCoreProcAuthToken();
    })
    .then(async (authTokenRes) => {
      appReady = true;
      authToken = authTokenRes;
      createWindow();

      if (process.env.NODE_ENV === "production") {
        // Installs the CLI on first run, or if it had been removed.
        if (!(await isCliInstalled())) {
          // out of band
          log("CLI is not installed and will be attempted in background now");
          downloadAndInstallCli()
            .then((version) => {
              log("CLI was installed on app startup", { version });
            })
            .catch((err) => {
              log("CLI failed to install on app startup", { err });
            });
        } else {
          log("CLI seems to already be installed");
        }
      }
    })
    .catch((err) => {
      log("app ready start from core fail", { err });
      // Without this, it is very hard to get information about a failed desktop app startup.
      dialog.showErrorBox(
        "EnvKey encountered an error on startup",
        inspect(err)
      );
    });
});

// Quit when all windows are closed, except on Mac where closing window is expected to behave like minimizing
// TODO: on mac there's no way to create a new window via menu, yet.
app.on("window-all-closed", () => {
  log("on:window-all-closed", {
    currentAppVersion: app.getVersion(),
  });
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (e) => {
  if (!appWillAutoExit) {
    e.preventDefault();
  }
  log("on:before-quit", {
    currentAppVersion: app.getVersion(),
    appWillAutoExit,
  });
  // anything crashing in here will leave the app running
  try {
    stopCoreProcess();
    await terminateWorkerPool();
  } catch (err) {
    log("before-exit cleanup failed", { err });
  }
  if (appWillAutoExit) {
    return;
  }

  app.exit();
});

app.on("activate", () => {
  log("on:activate", {
    currentAppVersion: app.getVersion(),
  });
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (appReady && !win) {
    createWindow();
  }
});

const createWindow = () => {
  // Create the browser window.
  const {
    width: screenW,
    height: screenH,
  } = screen.getPrimaryDisplay().workAreaSize;

  const userAgent = `${Client.CORE_PROC_AGENT_NAME}|Electron|${authToken}`;

  win = new BrowserWindow({
    width: Math.min(1400, Math.floor(screenW * 0.9)),
    height: Math.min(800, Math.floor(screenH * 0.9)),
    minWidth: 850,
    minHeight: 650,
    center: true,
    backgroundColor: "#404040",
    title: "EnvKey " + app.getVersion(),
    icon: path.join(__dirname, "../icon/64x64.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: true,
      preload: path.join(app.getAppPath(), "preload.js"),
    },
  });

  win.loadURL("http://localhost:19047/envkey-ui#", { userAgent });

  // Emitted when the window is closed.
  win.on("closed", () => {
    log("on:closed", {
      currentAppVersion: app.getVersion(),
    });
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = undefined;
  });
};

const setupAppUpdateMenu = () => {
  const menu = Menu.getApplicationMenu();
  if (!menu) {
    return;
  }

  const menuVersionInfo = new MenuItem({
    enabled: false,
    label: `v${app.getVersion()}`,
  });

  const menuCheckAppUpdate = new MenuItem({
    label: "Check for Updates",
    click: async () => {
      const runOnceInline = true;
      await runAppUpdate(() => {
        appWillAutoExit = true;
      }, runOnceInline);
    },
  });

  const menuInstallCli = new MenuItem({
    label: "Install CLI",
    click: () =>
      downloadAndInstallCli()
        .then((version) =>
          dialog.showMessageBox({
            title: "EnvKey CLI",
            message: `EnvKey CLI version ${version} was installed.`,
          })
        )
        .catch((err) => {
          log("cli update error", { err });
          dialog.showErrorBox("EnvKey CLI update", inspect(err));
        }),
  });

  const switchAccount = new MenuItem({
    label: "Switch Account",
    click: () => win?.loadURL("http://localhost:19047/envkey-ui#/select-account"),
  })

  // Add all items in order to the first menu. On mac, that's the "EnvKey" menu, on other
  // platforms it's the File menu.
  menu.items?.[0].submenu?.insert(1, menuVersionInfo);
  menu.items?.[0].submenu?.insert(2, menuCheckAppUpdate);
  menu.items?.[0].submenu?.insert(3, menuInstallCli);
  menu.items?.[0].submenu?.insert(4, switchAccount);

  Menu.setApplicationMenu(menu);
};

import { autoUpdater, UpdateCheckResult } from "electron-updater";
import { log } from "@core/lib/utils/logger";
import { app, dialog } from "electron";
import { wait } from "@core/lib/utils/wait";
import { downloadAndInstallCli } from "./cli_updates";
import {
  listVersionsGT,
  readReleaseNotesFromS3,
} from "@infra/artifact-helpers";
import {
  ENVKEY_RELEASES_BUCKET,
  envkeyReleasesS3Creds,
} from "@infra/stack-constants";

const TEN_MINS = 10 * 60 * 1000;
// allow looping only once
let loopInitialized = false;
let onInstallRestartReady: (() => void) | undefined;

autoUpdater.logger = {
  debug: (...args) => log("autoUpdater:debug", { data: args }),
  info: (...args) => log("autoUpdater:info", { data: args }),
  warn: (...args) => log("autoUpdater:warn", { data: args }),
  error: (...args) => log("autoUpdater:error  ", { data: args }),
};
// forces releaseNotes to string[]
autoUpdater.fullChangelog = true;
autoUpdater.autoDownload = false;

export const runAppUpdate = async (
  _onInstallRestartReady: () => void,
  singleInlineRun = false
) => {
  onInstallRestartReady = _onInstallRestartReady;

  log("init updates", {
    currentAppVersion: app.getVersion(),
  });

  if (singleInlineRun) {
    await runOnce(true);
    return;
  }

  if (loopInitialized) {
    log("app update loop already initialized; refusing to start again.");
    return;
  }

  // not returned
  runOnce(false).catch((err) => {
    log("update runOnce failed", { err });
  });

  setInterval(() => runOnce(false), TEN_MINS);
  loopInitialized = true;
  log("app update loop was just initialized");
};

const runOnce = async (singleInlineRun: boolean) => {
  let cliDownloaded = false;
  let nextVersion: string;
  let buttonClicked = 0;
  const releaseNotes: string[] = [];

  let result: UpdateCheckResult;
  try {
    result = await autoUpdater.checkForUpdates();
  } catch (err) {
    log("autoUpdater:checkForUpdates error", { err });
    return;
  }

  const hasUpdates =
    result?.updateInfo?.version &&
    result.updateInfo.version !== app.getVersion();

  log("autoUpdater:checkForUpdates resolved", {
    hasUpdates,
    ...result,
  });

  if (!hasUpdates) {
    if (singleInlineRun) {
      return dialog.showMessageBox({
        title: "EnvKey",
        message: `EnvKey is up to date.`,
      });
    }
    return;
  }

  const missedVersions = await listVersionsGT({
    bucket: ENVKEY_RELEASES_BUCKET,
    creds: envkeyReleasesS3Creds,
    currentVersionNumber: app.getVersion(),
    tagPrefix: "desktop",
  });

  let note: string = "";
  for (let ver of missedVersions) {
    try {
      log("Fetching desktop release notes for", { ver });
      note = await readReleaseNotesFromS3({
        bucket: ENVKEY_RELEASES_BUCKET,
        creds: envkeyReleasesS3Creds,
        project: "desktop",
        version: ver,
      });
      releaseNotes.push(
        `** Release ${ver} **\n${note.replace(/(<([^>]+)>)/gi, "\n")}`
      );
    } catch (err) {
      log("Ignoring error fetching desktop release notes", { ver, err });
      releaseNotes.push(`** Release ${ver}\n`);
    }
  }

  nextVersion = result.updateInfo.version;

  log("autoUpdater:update-available", {
    currentAppVersion: app.getVersion(),
    nextVersion,
    releaseNotes,
  });

  buttonClicked = dialog.showMessageBoxSync({
    buttons: ["Download In Background", "Later"],
    icon: undefined,
    message: "EnvKey Updates\n\n" + releaseNotes.join("\n\n"),
    normalizeAccessKeys: false,
    title: "Update Available", // not shown on mac
    type: "info",
  });

  if (buttonClicked !== 0) {
    // the user will be prompted next time they open the app to do the update.
    log("User chose to postpone app update", { buttonClicked });
    return;
  }
  log("User chose to download app update now");

  // background, given additional 30 secs after app is downloaded to complete.
  downloadAndInstallCli()
    .then(() => {
      cliDownloaded = true;
      log("cli install OK");
    })
    .catch((err) => {
      cliDownloaded = true;
      log("cli install failed", { err });
    });

  await autoUpdater.downloadUpdate();

  log("autoUpdater downloaded ok");
  // Prevent cli error or stuckness from blocking app restart. CLI isn't important enough to block
  // app restart.
  let i = 0;
  while (!cliDownloaded && i < 30) {
    log("autoUpdater:update-downloaded waiting for CLI");
    await wait(1000);
    i++;
  }

  buttonClicked = dialog.showMessageBoxSync({
    buttons: ["Restart App Now", "Later"],
    icon: undefined,
    message: `The latest version of Envkey has been installed. Restart the app to finish.`,
    normalizeAccessKeys: false,
    title: "Ready to Relaunch", // not shown on mac
    type: "info",
  });
  if (buttonClicked !== 0) {
    log("User chose to restart installed update later", { buttonClicked });
    return;
  }

  log("User chose to restart installed update now");

  onInstallRestartReady && onInstallRestartReady();

  // quits the app, downloads in the background, installs it, and relaunches
  try {
    autoUpdater.quitAndInstall(true, true);
  } catch (err) {
    log("autoUpdater failed to quit and install", { err });
  }
};

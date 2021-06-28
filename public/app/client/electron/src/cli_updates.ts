import * as os from "os";
import * as path from "path";
import { promises as fsp } from "fs";
import * as fs from "fs";
import gunzip from "gunzip-maybe";
import * as tar from "tar-fs";
import mkdirp from "mkdirp";
import {
  getReleaseAsset,
  getLatestReleaseVersion,
} from "@infra/artifact-helpers";
import {
  ENVKEY_RELEASES_BUCKET,
} from "@infra/stack-constants";
import { log, logStderr } from "@core/lib/utils/logger";
import { dialog } from "electron";

const ARCH = "amd64";
const platform = os.platform();

let platformIdentifier: string = platform;
if (platform === "win32") {
  platformIdentifier = "windows";
}

// resolves to version number installed
export const downloadAndInstallCli = async (): Promise<string> => {
  log("cli update: init");

  // TODO: there currently no way to test upgrade to non-public final releases of the CLI from inside the desktop
  const latestVersionNumber = (await getLatestReleaseVersion({
    project: "cli",
    bucket: ENVKEY_RELEASES_BUCKET,
  }))!;
  log("cli update: got latest version", { latestVersionNumber });

  const assetName = `envkey-cli_${latestVersionNumber}_${platformIdentifier}_${ARCH}.tar.gz`;
  const cliFileAsBuf = await getReleaseAsset({
    bucket: ENVKEY_RELEASES_BUCKET,
    releaseTag: `cli-v${latestVersionNumber}`,
    assetName,
  });
  log("cli update: fetched latest archive", {
    sizeBytes: Buffer.byteLength(cliFileAsBuf),
    assetName,
  });

  const folder = await unpackToFolder(cliFileAsBuf);
  log("cli update: unpacked to folder", { folder });

  switch (platform) {
    case "darwin":
      await installMac(latestVersionNumber, folder);
      break;
    case "linux":
      await installLinux(latestVersionNumber, folder);
      break;
    case "win32":
      await installWindows(latestVersionNumber, folder);
      break;
    default:
      throw new Error(`Cannot install to unsupported CLI platform ${platform}`);
  }

  log("cli update: completed successfully", {
    latestVersionNumber,
  });

  return latestVersionNumber;
};

type PlatformInstall = (
  version: string,
  cliArchiveFilepath: string
) => Promise<void>;

// only envkey executable (no keytar)
// sudo prompt necessary to complete install. Want to minimize that happening.
const installLinux: PlatformInstall = async (
  version: string,
  folder: string
) => {
  const archiveFile = path.resolve(folder, "envkey");
  const finalFile = "/usr/local/bin/envkey";

  let button: number | undefined;
  try {
    // async to avoid blocking concurrent app install
    button = (
      await dialog.showMessageBox({
        title: "EnvKey Access",
        message: `To install the envkey command line tools, you will be prompted for sudo access.`,
        buttons: ["OK", "Skip"],
      })
    )?.response;
  } catch (ignored) {}
  if (button !== 0) {
    throw new Error("EnvKey CLI tools were declined.");
  }

  await copyCliFile(archiveFile, finalFile);
};

// envkey.exe and keytar.node
// No privilege escalation needed.
const installWindows: PlatformInstall = async (
  version: string,
  folder: string
) => {
  const files = (await fsp.readdir(folder)).filter(
    (f) => f === "envkey.exe" || path.extname(f) === ".node"
  ); // exclude licenses or other files

  await safeCopyFiles(folder, files, getWindowsBin());
};
const getWindowsBin = () => path.resolve(os.homedir(), "bin");

// envkey and keytar.node
// No sudo needed.
const installMac: PlatformInstall = async (version: string, folder: string) => {
  const files = (await fsp.readdir(folder)).filter(
    (f) => f === "envkey" || path.extname(f) === ".node"
  ); // exclude licenses or other files

  await safeCopyFiles(folder, files, "/usr/local/bin");
};

const safeCopyFiles = async (
  folder: string,
  files: string[],
  destinationFolder: string
) => {
  try {
    if (!(await fileExists(destinationFolder))) {
      await makeDir(destinationFolder);
    }
  } catch (ignored) {}

  for (const f of files) {
    const archiveFile = path.resolve(folder, f);
    const finalFile = path.resolve(destinationFolder, f);
    const backupFile = finalFile + ".bak";
    // remove any existing backup
    try {
      await delCliFile(backupFile);
    } catch (ignored) {}
    // best effort backup existing file if exists
    try {
      await copyCliFile(finalFile, backupFile);
      log("cli update: file backed up", { backupFile });
    } catch (ignored) {}
    // remove existing file
    try {
      await delCliFile(finalFile);
    } catch (ignored) {}

    try {
      await copyCliFile(archiveFile, finalFile);
      log("cli update: added file", { finalFile });
    } catch (err) {
      await tryRestoreBackups(folder, files, destinationFolder);
      logStderr("cli update: tried rollback", { err, folder, files });
      throw err;
    }
  }
};

const tryRestoreBackups = async (
  folder: string,
  originalFilenames: string[],
  destinationFolder: string
) => {
  for (const f of originalFilenames) {
    const full = path.resolve(folder, f);
    if (!(await fileExists(full)) + ".bak") {
      // don't touch anything if the backup does not exist
      continue;
    }
    try {
      await delCliFile(full);
    } catch (ignored) {}
    try {
      await copyCliFile(
        path.resolve(folder, f + ".bak"),
        path.resolve(destinationFolder, f)
      );
    } catch (ignored) {}
  }
};

// resolves to the folder where it unrolled the archive
const unpackToFolder = async (archiveBuf: Buffer): Promise<string> => {
  return new Promise(async (resolve, reject) => {
    const tempFileBase = `envkey-cli_${+new Date() / 1000}`;
    const tempFilePath = path.resolve(os.tmpdir(), `${tempFileBase}.tar.gz`);
    const tempFileTarPath = path.resolve(os.tmpdir(), `${tempFileBase}.tar`);
    const tempOutputDir = path.resolve(os.tmpdir(), tempFileBase);
    await fsp.writeFile(tempFilePath, archiveBuf);
    const tarredGzipped = fs.createReadStream(tempFilePath);
    const tarredOnlyWrite = fs.createWriteStream(tempFileTarPath);

    tarredGzipped.on("error", reject);
    tarredOnlyWrite.on("error", reject);
    tarredOnlyWrite.on("close", () => {
      const tarredOnlyRead = fs.createReadStream(tempFileTarPath);
      tarredOnlyRead.on("error", reject);
      tarredOnlyRead.on("close", () => {
        resolve(tempOutputDir);
      });
      tarredOnlyRead.pipe(tar.extract(tempOutputDir));
    });

    tarredGzipped.pipe(gunzip()).pipe(tarredOnlyWrite);
  });
};

const makeDir = async (dir: string): Promise<void> => {
  if (platform === "linux") {
    return new Promise((resolve, reject) => {
      try {
        require("sudo-prompt").exec(
          `mkdir -p dir`,
          {
            name: `EnvKey CLI File Installer`,
          },
          (err: Error | undefined, stdout: string, stderr: string) => {
            log(`linux make dir`, { dir, stdout, stderr });
            if (err) {
              return reject(err);
            }
            resolve();
          }
        );
      } catch (err) {
        reject(err);
      }
    });
  }

  await mkdirp(dir);
};

// cross-platform copy a file and overwrite if it exists. GUI prompts for sudo on linux only.
const copyCliFile = async (from: string, to: string): Promise<void> => {
  if (platform === "linux") {
    return new Promise((resolve, reject) => {
      try {
        require("sudo-prompt").exec(
          `cp -f ${from} ${to}`,
          {
            name: `EnvKey CLI File Installer`,
          },
          (err: Error | undefined, stdout: string, stderr: string) => {
            log(`copyCliFile`, { to, from, stdout, stderr });
            if (err) {
              return reject(err);
            }
            resolve();
          }
        );
      } catch (err) {
        reject(err);
      }
    });
  }

  await fsp.copyFile(from, to);
};

const delCliFile = async (filename: string): Promise<void> => {
  if (platform === "linux") {
    return new Promise((resolve, reject) => {
      try {
        require("sudo-prompt").exec(
          `rm -f ${filename}`,
          {
            name: `EnvKey CLI File Cleanup`,
          },
          (err: Error | undefined, stdout: string, stderr: string) => {
            log(`deleteCliFile`, { filename, stdout, stderr });
            if (err) {
              return reject(err);
            }
            resolve();
          }
        );
      } catch (err) {
        reject(err);
      }
    });
  }

  await fsp.unlink(filename);
};

export const isCliInstalled = async (): Promise<boolean> => {
  const expectedBin =
    platformIdentifier === "windows"
      ? path.resolve(getWindowsBin(), "envkey.exe")
      : `/usr/local/bin/envkey`;

  return fileExists(expectedBin);
};

// fs.exists async was deprecated
const fileExists = async (filepath: string): Promise<boolean> => {
  try {
    await fsp.stat(filepath);
    return true;
  } catch (ignored) {
    return false;
  }
};

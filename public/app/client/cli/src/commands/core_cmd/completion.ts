import { exit } from "../../lib/process";
import { Argv, showCompletionScript } from "yargs";
import { BaseArgs } from "../../types";
import { homedir } from "os";
import * as fs from "fs";
import * as path from "path";

const YARGS_PLACEHOLDER_START = "###-begin-envkey-completions-###";
const YARGS_PLACEHOLDER_END = "###-end-envkey-completions-###";

export const command = "completion [action]";
export const desc = "Manage shell autocomplete integration";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs.positional("action", {
    type: "string",
    choices: ["check", "install", "uninstall"],
  })
    .option("profile-file", {
      type: "string",
      describe: "File path for installing autocomplete. If not provided, will be auto-detected."
    });
export const handler = async (argv: BaseArgs & { action?: string, "profile-file"?: string }): Promise<void> => {
  if (!argv.$0.match(/envkey$/)) {
    console.log(
      `Warning! Installing bash completion has unexpected behavior when the binary is not named 'envkey' (binary is: ${argv.$0})`
    );
  }
  const shellFile = argv["profile-file"] || getDefaultShellInitFile();
  const backupShellFile = `${shellFile}.bak`;
  const isInstalled = hasEnvkeyYargsBashFunc(shellFile);
  const currentFileContents = fs.readFileSync(shellFile, { encoding: "utf8" });

  console.log("Using", shellFile);

  if (argv.action === "check") {
    console.log(
      isInstalled
        ? "envkey CLI completion appears to be installed"
        : "envkey CLI completion does NOT appear to be installed"
    );
    return exit();
  }

  // making a backup. the next two actions can change things
  fs.writeFileSync(backupShellFile, currentFileContents, { encoding: "utf8" });
  console.log("Wrote backup shell file to", backupShellFile);

  if (argv.action === "uninstall") {
    if (!isInstalled) {
      console.log("envkey CLI completion does not appear to be installed");
      return exit();
    }
    try {
      console.log("Uninstalling shell autocomplete...");

      const contentToRemove = currentFileContents
        .split(YARGS_PLACEHOLDER_START)[1]
        .split(YARGS_PLACEHOLDER_END)[0];
      const nextFileContents = currentFileContents
        .replace(contentToRemove, "")
        .replace(YARGS_PLACEHOLDER_START, "")
        .replace(YARGS_PLACEHOLDER_END, "");
      fs.writeFileSync(shellFile, nextFileContents, { encoding: "utf8" });

      if (hasEnvkeyYargsBashFunc(shellFile)) {
        throw new Error("Something went wrong with autocomplete uninstall");
      }

      console.log("envkey CLI autocompletion was removed successfully");
    } catch (err) {
      return exit(1, err.message || err);
    }

    return exit();
  }

  if (hasEnvkeyYargsBashFunc(shellFile)) {
    console.log(
      "envkey CLI completion appears to be installed already - you must uninstall before installing again"
    );
    return exit();
  }

  // INSTALL
  console.log("Installing shell autocomplete...");
  try {
    const completionBlurb = captureCompletionScript();
    const nextFileContents =
      currentFileContents + "\n" + completionBlurb + "\n";
    fs.writeFileSync(shellFile, nextFileContents, { encoding: "utf8" });
    if (!hasEnvkeyYargsBashFunc(shellFile)) {
      throw new Error("Something went wrong with autocomplete installation");
    }
  } catch (err) {
    return exit(1, err.message || err);
  }

  console.log(
    "envkey CLI completion was installed successfully - it will be available after starting a new shell"
  );

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

const hasEnvkeyYargsBashFunc = (file: string): boolean => {
  const contents = fs.readFileSync(file, { encoding: "utf8" });
  return (
    contents.includes(YARGS_PLACEHOLDER_START) &&
    contents.includes(YARGS_PLACEHOLDER_END)
  );
};

const captureCompletionScript = (): string => {
  // yargs forces console.log via an internal logger we can't capture or disable.
  // monkey-patch it real quick
  const originalConsoleLog = console.log;
  let output = "";
  console.log = (s: any) => {
    output += s;
  };
  showCompletionScript();
  console.log = originalConsoleLog;
  return output;
};
type Shell = "bash" | "zsh" | "fish";

const getActiveShell = (): Shell => {
  if (!process.env.SHELL) {
    throw new Error("Shell could not be detected. Try re-running with --profile-file option");
  }
  if (process.env.SHELL.match(/bash/)) {
    return "bash";
  }
  if (process.env.SHELL.match(/zsh/)) {
    return "zsh";
  }
  if (process.env.SHELL.match(/fish/)) {
    return "fish";
  }
  throw new Error(`Unsupported shell: ${process.env.SHELL}`);
};

const fileAtHome = (file: string) => path.join(homedir(), file);
const fileExists = (file: string): boolean => {
  try {
    fs.statSync(file);
    return true;
  } catch (ignored) {
    return false;
  }
};

const getDefaultShellInitFile = (): string => {
  switch (getActiveShell()) {
    case "bash":
      const profile = fileAtHome(".profile");
      if (fileExists(profile)) {
        return profile;
      }
      const bprofile = fileAtHome(".bash_profile");
      if (fileExists(bprofile)) {
        return bprofile;
      }
      const rc = fileAtHome(".bashrc");
      if (fileExists(rc)) {
        return rc;
      }
      throw new Error("No bash profile found");
    case "zsh":
      return fileAtHome(".zshrc");
    case "fish":
      return fileAtHome(".config/fish/config.fish");
    default:
      throw new Error(`Unsupported shell file for ${getActiveShell()}`);
  }
};

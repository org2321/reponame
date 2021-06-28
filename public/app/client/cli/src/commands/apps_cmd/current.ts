import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { startCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { getCoreProcAuthToken } from "@core/lib/client_store/key_store";
import { fetchState } from "@core/lib/core_proc";
import { detectAppFromEnv } from "../../lib/auth";
import { Model } from "@core/types";
import chalk from "chalk";
import { autoModeOut } from "../../lib/console_io";

export const command = ["current"];
export const desc = "Show the app detected from an ENVKEY or .env file";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs.option("short", { type: "boolean" });
export const handler = async (argv: BaseArgs & { short: boolean }): Promise<void> => {
  try {
    await startCore();

    let appName: string | undefined;
    let orgName: string | undefined;

    const encryptedAuthToken = await getCoreProcAuthToken();
    let state = await fetchState(undefined, encryptedAuthToken);
    const detected = await detectAppFromEnv(state, argv, process.cwd());
    if (!detected) {
      if (!argv["short"]) {
        console.log("No ENVKEY was found");
      }
      return exit();
    }

    state = await fetchState(detected.accountId, encryptedAuthToken);

    appName = (state.graph[detected.appId] as Model.App)?.name;
    orgName = state.orgUserAccounts[detected.accountId]?.orgName;

    if (argv["short"]) {
      console.log(orgName, "-", appName);
    } else {
      console.log(
        "The current app is",
        chalk.bold(appName),
        "in organization",
        chalk.bold(orgName) + ". ENVKEY found",
        detected.envkeyFromEnvironment
          ? "in environment variable."
          : `in ${chalk.bold(detected.dotenvFile)}`
      );
    }

    autoModeOut(detected);

  } catch (err) {
    if (argv["verbose"]) {
      console.error(err);
    }
  }

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

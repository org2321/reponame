import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { findApp, findBlock, getAppAndBlockChoices } from "../../lib/args";
import { getEnvironmentTree } from "../../lib/envs";
import chalk from "chalk";
import { autoModeOut, getPrompt } from "../../lib/console_io";
import {
  getEnvironmentName,
  getEnvironmentsByEnvParentId,
} from "@core/lib/graph";
import * as R from "ramda";
import { Model } from "@core/types";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["list [app-or-block]", "ls [app-or-block]"];
export const desc = "List environments for an app or block";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs.positional("app-or-block", {
    type: "string",
    describe: "app or block name",
  });
export const handler = async (
  argv: BaseArgs & { "app-or-block"?: string }
): Promise<void> => {
  const prompt = getPrompt();
  let { auth, state } = await initCore(argv, true);
  let appOrBlock: Model.EnvParent | undefined;

  if (argv["app-or-block"]) {
    appOrBlock =
      findApp(state.graph, argv["app-or-block"]) ||
      findBlock(state.graph, argv["app-or-block"]);
  }

  // detection from ENVKEY
  if (!appOrBlock) {
    if (tryApplyEnvkeyOverride(auth.userId, argv)) {
      return handler(argv);
    }
    const appId = argv["detectedEnvkey"]?.appId?.toLowerCase();
    if (appId) {
      const otherArgsValid = !argv["app-or-block"];
      if (otherArgsValid) {
        appOrBlock = state.graph[appId] as Model.App | undefined;
        if (appOrBlock) {
          console.log("Detected app", chalk.bold(appOrBlock.name), "\n");
        }
      }
    }
  }

  if (!appOrBlock) {
    const parentName = (
      await prompt<{ appOrBlock: string }>({
        type: "select",
        name: "appOrBlock",
        message: "Select app or block:",
        initial: 0,
        choices: getAppAndBlockChoices(state.graph),
      })
    ).appOrBlock as string;
    appOrBlock =
      findApp(state.graph, parentName) || findBlock(state.graph, parentName);
  }

  if (!appOrBlock) {
    return exit(1, chalk.red.bold("App/block not found!"));
  }

  console.log(getEnvironmentTree(state.graph, appOrBlock.id), "\n");
  autoModeOut({
    [appOrBlock.type + "Id"]: appOrBlock.id,
    envs:
      getEnvironmentsByEnvParentId(state.graph)[appOrBlock.id]?.map((e) => ({
        id: e.id,
        name: getEnvironmentName(state.graph, e.id),
        ...R.pick(["environmentRoleId", "isSub"], e),
      })) || [],
  });

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

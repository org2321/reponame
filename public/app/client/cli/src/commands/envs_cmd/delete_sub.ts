import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { authz, getEnvironmentName } from "@core/lib/graph";

import { Api } from "@core/types";
import chalk from "chalk";
import {
  findApp,
  findBlock,
  logAndExitIfActionFailed,
  mustSelectSubEnvironmentForDeletion,
} from "../../lib/args";
import * as R from "ramda";
import { getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = "delete-sub [app-or-block] [sub-environment]";
export const desc = "Delete a sub-environment for an app or block.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("app-or-block", {
      type: "string",
      describe: "app or block name",
    })
    .positional("sub-environment", {
      type: "string",
      describe: "sub-environment name",
    })
    .option("parent-environment", {
      type: "string",
      describe: "parent-environment name",
    })
    .option("force", {
      type: "boolean",
      alias: "f",
      describe: "Skip confirm before deletion",
    });
export const handler = async (
  argv: BaseArgs & {
    "app-or-block"?: string;
    "sub-environment"?: string;
    "parent-environment"?: string;
    force?: boolean;
  }
): Promise<void> => {
  const prompt = getPrompt();
  let { state, auth } = await initCore(argv, true);

  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }

  const appBlockChoices = R.sortBy(
    R.prop("message"),
    authz
      .getEnvParentsWithDeletableSubEnvironments(state.graph, auth.userId)
      .map((envParent) => ({
        name: envParent.id,
        message: `${envParent.type} - ${chalk.bold(envParent.name)}`,
      }))
  );
  if (!appBlockChoices.length) {
    return exit(
      1,
      chalk.red(
        "There are no apps or blocks for which you are allowed to delete sub-environments."
      )
    );
  }

  const parentName = (argv["app-or-block"] ??
    (
      await prompt<{ appOrBlock: string }>({
        type: "select",
        name: "appOrBlock",
        message: "Select app or block:",
        initial: 0,
        choices: appBlockChoices,
      })
    ).appOrBlock) as string;
  const appOrBlock =
    findApp(state.graph, parentName) || findBlock(state.graph, parentName);
  if (!appOrBlock) {
    return exit(1, chalk.red.bold("App not found!"));
  }

  const subEnv = await mustSelectSubEnvironmentForDeletion(
    state.graph,
    auth.userId,
    appOrBlock.id,
    argv["sub-environment"],
    argv["parent-environment"]
  );

  if (
    !subEnv.isSub ||
    !authz.canDeleteEnvironment(state.graph, auth.userId, subEnv.id)
  ) {
    return exit(
      1,
      chalk.red.bold(
        "You do not have permission to delete this sub-environment."
      )
    );
  }

  // One may make threats, but can one bring oneself to destroy like this?
  if (!argv.force) {
    const { confirm } = await prompt<{ confirm: boolean }>({
      type: "confirm",
      name: "confirm",
      message: `Delete ${chalk.bold(
        appOrBlock.name
      )} sub-environment of ${chalk.bold(
        getEnvironmentName(state.graph, subEnv.parentEnvironmentId)
      )} - ${chalk.bold(
        getEnvironmentName(state.graph, subEnv.id)
      )} and all its config? This action cannot be reversed!`,
    });

    if (!confirm) {
      console.log(chalk.bold("App deletion aborted!"));
      return exit();
    }
  }

  const res = await dispatch({
    type: Api.ActionType.DELETE_ENVIRONMENT,
    payload: {
      id: subEnv.id,
    },
  });

  await logAndExitIfActionFailed(
    res,
    "The sub-environment could not be deleted!"
  );

  console.log(
    `Sub-environment ${chalk.bold(
      getEnvironmentName(state.graph, subEnv.id)
    )} was deleted!`
  );

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

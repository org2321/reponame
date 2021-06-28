import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { authz, getEnvironmentName } from "@core/lib/graph";

import { Api } from "@core/types";
import chalk from "chalk";
import { findApp, findBlock, logAndExitIfActionFailed } from "../../lib/args";
import { findEnvironment } from "../../lib/envs";
import * as R from "ramda";
import { autoModeOut, getPrompt } from "../../lib/console_io";
import {tryApplyEnvkeyOverride} from "../../envkey_detection";

export const command = "create-sub [app-or-block] [environment] [name]";
export const desc = "Create a sub-environment for an app or block.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("app-or-block", {
      type: "string",
      describe: "app or block name",
    })
    .positional("environment", {
      type: "string",
      describe: "environment name",
      coerce: R.toLower,
    })
    .positional("name", {
      type: "string",
      describe: "new sub-environment name",
    });
export const handler = async (
  argv: BaseArgs & {
    "app-or-block"?: string;
    environment?: string;
    name?: string;
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
      .getCanCreateSubEnvironmentsForEnvParents(state.graph, auth.userId)
      .map((envParent) => ({
        name: envParent.id,
        message: chalk.bold(envParent.name),
      }))
  );
  if (!appBlockChoices.length) {
    return exit(
      1,
      chalk.red(
        "There are no apps or blocks for which you are allowed to create sub-environments."
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
    return exit(1, chalk.red.bold("App/block not found!"));
  }

  const availableParentEnvironmentChoices = authz
    .getCanCreateSubEnvironmentForEnvironments(
      state.graph,
      auth.userId,
      appOrBlock.id
    )
    .map((env) => ({
      name: getEnvironmentName(state.graph, env.id),
      message: chalk.bold(getEnvironmentName(state.graph, env.id)),
    }));
  if (!availableParentEnvironmentChoices.length) {
    return exit(
      1,
      chalk.red(
        `You do not have permission to create sub-environments for the ${
          appOrBlock.type
        } ${chalk.bold(appOrBlock.name)}!`
      )
    );
  }
  const parentEnvironmentName = (argv.environment ??
    (
      await prompt<{ environment: string }>({
        type: "select",
        name: "environment",
        message: "Select parent environment:",
        initial: 0,
        choices: availableParentEnvironmentChoices,
      })
    ).environment) as string;
  const parentEnvironment = findEnvironment(
    state.graph,
    appOrBlock.id,
    parentEnvironmentName
  );
  if (!parentEnvironment) {
    return exit(
      1,
      chalk.red(
        `Environment ${chalk.bold(
          parentEnvironmentName
        )} does not exist, or you do not have access.`
      )
    );
  }
  if (
    parentEnvironment.isSub ||
    !authz.canCreateSubEnvironment(
      state.graph,
      auth.userId,
      parentEnvironment.id
    )
  ) {
    return exit(
      1,
      chalk.red(
        `You are not allowed to create of a sub-environment of ${chalk.bold(
          parentEnvironmentName
        )}.`
      )
    );
  }

  const name =
    argv.name ??
    (
      await prompt<{ name: string }>({
        type: "input",
        name: "name",
        required: true,
        message: "New sub-environment name:",
      })
    ).name;

  const res = await dispatch({
    type: Api.ActionType.CREATE_ENVIRONMENT,
    payload: {
      isSub: true,
      envParentId: appOrBlock.id,
      environmentRoleId: parentEnvironment.environmentRoleId,
      parentEnvironmentId: parentEnvironment.id,
      subName: name,
    },
  });

  await logAndExitIfActionFailed(
    res,
    "The sub-environment could not be created!"
  );

  console.log(`Sub-environment ${chalk.bold(name)} was created!`);
  autoModeOut({
    id: (res.resultAction as any)?.id,
    envParentId: appOrBlock.id,
    environmentRoleId: parentEnvironment.environmentRoleId,
    parentEnvironmentId: parentEnvironment.id,
  });

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { authz, getAppRoleForUserOrInvitee, graphTypes } from "@core/lib/graph";

import { Api } from "@core/types";
import chalk from "chalk";
import * as R from "ramda";
import Table from "cli-table3";
import { getEnvironmentTree } from "../../lib/envs";
import { logAndExitIfActionFailed } from "../../lib/args";
import { autoModeOut, getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = "create [name]";
export const desc =
  "Create a resuable config block which can be referenced from many apps.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs.positional("name", { type: "string", describe: "block name" });
export const handler = async (
  argv: BaseArgs & { name?: string }
): Promise<void> => {
  const prompt = getPrompt();
  let { state, auth } = await initCore(argv, true);

  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }

  if (!authz.canCreateBlock(state.graph, auth.userId)) {
    return exit(1, chalk.red("You do not have permission to create blocks."));
  }

  const name =
    argv.name ??
    (
      await prompt<{ name: string }>({
        type: "input",
        name: "name",
        message: "Block name:",
      })
    ).name;

  const res = await dispatch({
    type: Api.ActionType.CREATE_BLOCK,
    payload: {
      name,
      settings: {
        autoCaps: true,
      },
    },
  });

  await logAndExitIfActionFailed(
    res,
    `Creating the block ${chalk.bold(name)} failed!`
  );

  state = res.state;

  const newBlock = graphTypes(state.graph).blocks.find(
    R.propEq("createdAt", state.graphUpdatedAt)
  );
  if (!newBlock) {
    return exit(
      1,
      chalk.red.bold("Failed fetching block after successful creation!")
    );
  }

  console.log(chalk.bold("Block created!\n"));

  const blockRole = getAppRoleForUserOrInvitee(
    state.graph,
    newBlock.id,
    auth.userId
  );

  const table = new Table({
    colWidths: [15, 40],
  });

  table.push(
    ["Block Name", chalk.bold(newBlock.name)],
    ["Your Role", chalk.bold(blockRole!.name)],
    ["Environments", chalk.bold(getEnvironmentTree(state.graph, newBlock.id))]
  );

  console.log(table.toString());
  console.log("");
  autoModeOut({ id: newBlock.id });

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

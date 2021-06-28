import R from "ramda";
import { exit } from "../../lib/process";
import { Argv } from "yargs";

import { initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import {
  getAppRoleForUserOrInvitee,
  getConnectedAppsForBlock,
  graphTypes,
} from "@core/lib/graph";
import chalk from "chalk";
import Table from "cli-table3";
import { autoModeOut } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["list", "ls"];
export const desc = "List permitted reusable config blocks";
export const builder = (yargs: Argv<BaseArgs>) => yargs;
export const handler = async (argv: BaseArgs): Promise<void> => {
  const { state, auth } = await initCore(argv, true);

  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }

  const blocks = R.sortBy(R.prop("name"), graphTypes(state.graph).blocks);
  if (!blocks.length) {
    console.log(chalk.bold("You don't have access to any blocks."));
    return exit();
  }

  const table = new Table({
    head: ["Block Name", "Your Role", "Connected Apps"],
    colWidths: [35, 25, 35],
    style: {
      head: [], //disable colors in header cells
    },
  });

  console.log(
    chalk.bold(
      `You have access to ${blocks.length} block${
        blocks.length > 1 ? "s" : ""
      }:\n`
    )
  );

  for (let b of blocks) {
    const role = getAppRoleForUserOrInvitee(state.graph, b.id, auth.userId);
    const apps = getConnectedAppsForBlock(state.graph, b.id);
    table.push([chalk.bold(b.name), chalk.bold(role!.name), apps.length]);
  }

  console.log(table.toString());
  autoModeOut({
    blocks: blocks.map((b) => ({
      ...R.pick(["id", "name"], b),
      apps: getConnectedAppsForBlock(state.graph, b.id)?.map(R.prop("id")),
    })),
  });

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

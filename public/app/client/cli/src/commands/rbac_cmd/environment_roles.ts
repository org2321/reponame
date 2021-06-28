import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { graphTypes } from "@core/lib/graph";
import chalk from "chalk";
import Table from "cli-table3";
import * as R from "ramda";
import { autoModeOut } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = [
  "environment-roles list",
  "environment-roles ls",
  "env-roles list",
  "env-roles ls",
];
export const desc = "List environment roles.";
export const builder = (yargs: Argv<BaseArgs>) => yargs;
export const handler = async (argv: BaseArgs): Promise<void> => {
  const { state, auth } = await initCore(argv, true);
  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }

  const table = new Table({
    head: ["Environment Role", "Default All", "Description"],
    colWidths: [25, 25, 40],
    style: {
      head: [], //disable colors in header cells
    },
  });

  for (let envRole of graphTypes(state.graph).environmentRoles) {
    const defaultAllDisplay = [
      envRole.defaultAllApps ? "Apps" : "",
      envRole.defaultAllBlocks ? "Blocks" : "",
    ]
      .filter(Boolean)
      .join(", ");

    table.push([
      chalk.bold(envRole.name),
      defaultAllDisplay,
      envRole.description,
    ]);
  }

  console.log(table.toString());
  autoModeOut(
    graphTypes(state.graph).environmentRoles.map((r) =>
      R.pick(
        [
          "id",
          "name",
          "isDefault",
          "hasLocalKeys",
          "hasServers",
          "defaultAllApps",
          "defaultAllBlocks",
          "settings",
        ],
        r
      )
    )
  );
  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

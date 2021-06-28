import * as R from "ramda";
import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { graphTypes, getAppRoleForUserOrInvitee } from "@core/lib/graph";
import chalk from "chalk";
import Table from "cli-table3";
import { autoModeOut } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["list", "ls"];
export const desc = "List permitted apps.";
export const builder = (yargs: Argv<BaseArgs>) => yargs;
export const handler = async (argv: BaseArgs): Promise<void> => {
  const { state, auth } = await initCore(argv, true);
  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }
  const graph = state.graph;
  const apps = R.sortBy(R.prop("name"), graphTypes(graph).apps);
  const table = new Table({
    head: ["App Name", "Your Role"],
    colWidths: [35, 25],
    style: {
      head: [], //disable colors in header cells
    },
  });

  if (apps.length == 0) {
    console.log(chalk.bold("You don't have access to any apps."));
    return exit();
  }

  console.log(
    chalk.bold(
      `You have access to ${apps.length} app${apps.length > 1 ? "s" : ""}:\n`
    )
  );

  for (let app of apps) {
    const role = getAppRoleForUserOrInvitee(graph, app.id, auth.userId);
    table.push([chalk.bold(app.name), chalk.bold(role!.name)]);
  }

  console.log(table.toString());
  autoModeOut({
    appRoles: graphTypes(state.graph).appRoles.map((ar) =>
      R.pick(
        [
          "type",
          "id",
          "name",
          "defaultAllApps",
          "canHaveCliUsers",
          "hasFullEnvironmentPermissions",
          "isDefault",
          "canInviteAppRoleIds",
          "canManageAppRoleIds",
        ],
        ar
      )
    ),
    apps: apps.map((app) => ({ ...R.pick(["type", "id", "name"], app) })),
  });

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

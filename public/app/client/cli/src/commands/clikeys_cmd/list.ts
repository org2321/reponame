import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { graphTypes } from "@core/lib/graph";
import chalk from "chalk";
import Table from "cli-table3";
import * as R from "ramda";
import { Model, Rbac } from "@core/types";
import { autoModeOut } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["list", "ls"];
export const desc = "List CLI ENVKEY users.";
export const builder = (yargs: Argv<BaseArgs>) => yargs;
export const handler = async (argv: BaseArgs): Promise<void> => {
  const { state, auth } = await initCore(argv, true);
  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }

  const table = new Table({
    head: ["User Name", "Org Role", "Active", "CLI User ID"],
    style: {
      head: [], //disable colors in header cells
    },
  });

  const cliUsers = R.sort(
    R.ascend(R.prop("name")),
    graphTypes(state.graph).cliUsers
  ).filter((u) => !u.deactivatedAt) as Model.CliUser[];

  for (let user of cliUsers) {
    const orgRole = state.graph[user.orgRoleId] as Rbac.OrgRole;

    table.push([
      chalk.bold(user.name),
      orgRole.name,
      user.deactivatedAt ? chalk.red("Deactivated") : chalk.green("Active"),
      user.id,
    ]);
  }

  console.log(table.toString());
  autoModeOut({
    cliKeys: cliUsers.map((cli) => R.pick(["id", "name", "orgRoleId"], cli)),
  });

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

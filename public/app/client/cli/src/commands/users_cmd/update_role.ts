import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import chalk from "chalk";
import { Client, Rbac } from "@core/types";
import {
  findUser,
  logAndExitIfActionFailed,
  sortByPredefinedOrder,
} from "../../lib/args";
import { authz } from "@core/lib/graph";
import * as R from "ramda";
import { autoModeOut, getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = [
  "update-role [user] [role]",
  "change-role [user] [role]",
];
export const desc = "Change user to a different access role.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("user", {
      type: "string",
      describe: "user email or id",
    })
    .positional("role", {
      type: "string",
      describe: "id of org role",
    });
export const handler = async (
  argv: BaseArgs & { user?: string; role?: string }
): Promise<void> => {
  const prompt = getPrompt();
  const { state, auth } = await initCore(argv, true);
  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }

  const userChoices = R.sortBy(
    R.prop("message"),
    authz.getRoleUpdateableUsers(state.graph, auth.userId).map((u) => ({
      name: u.id,
      message: `${u.email} - ${u.firstName} ${u.lastName} - ${
        (state.graph[u.orgRoleId] as Rbac.OrgRole).name
      }`,
    }))
  );
  if (!userChoices.length) {
    return exit(
      1,
      chalk.red(
        "There are no users for which you have permission to modify the organization role."
      )
    );
  }

  const userName =
    argv.user ??
    (
      await prompt<{ userId: string }>({
        type: "select",
        name: "userId",
        message: "Select a user:",
        initial: 0,
        required: true,
        choices: userChoices,
      })
    ).userId;

  const user = findUser(state.graph, userName);
  if (!user) {
    return exit(1, chalk.red.bold("User not found"));
  }
  if (user.type === "cliUser") {
    return exit(
      1,
      chalk.red.bold("Cannot modify CLI user role with this command")
    );
  }

  const currentRole = state.graph[user.orgRoleId] as Rbac.OrgRole;

  console.log(
    `\n${chalk.bold(user.email)} has current role: ${chalk.bold(
      currentRole.name
    )}\n`
  );

  const newRoleChoices = sortByPredefinedOrder(
    ["Basic User", "Org Admin", "Org Owner"],
    authz.getOrgRolesAssignableToUser(state.graph, auth.userId, user.id),
    "defaultName"
  ).map((or) => ({
    name: or.id,
    message: `${chalk.bold(or.name)} - ${or.description}`,
  }));
  if (!newRoleChoices) {
    return exit(
      1,
      chalk.red("You are not allowed to assign any other roles to this user!")
    );
  }

  const newRoleId =
    argv.role ??
    (
      await prompt<{ newRoleId: string }>({
        type: "select",
        name: "newRoleId",
        message: "Select a new role:",
        required: true,
        choices: newRoleChoices,
      })
    ).newRoleId;
  if (newRoleId === currentRole.id) {
    console.log(`${chalk.bold("The role is the same.")} No work was done.`);
    return exit();
  }
  if (!authz.canUpdateUserRole(state.graph, auth.userId, user.id, newRoleId)) {
    console.error(
      chalk.red("You are not allowed to assign that role to the user.")
    );
    return exit();
  }

  const res = await dispatch({
    type: Client.ActionType.UPDATE_USER_ROLES,
    payload: [
      {
        id: user.id,
        orgRoleId: newRoleId,
      },
    ],
  });

  await logAndExitIfActionFailed(
    res,
    "Changing the user organization role failed!"
  );

  console.log(chalk.bold("The role for the user was updated successfully."));
  autoModeOut({ id: user.id, type: user.type, orgRoleId: newRoleId });

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

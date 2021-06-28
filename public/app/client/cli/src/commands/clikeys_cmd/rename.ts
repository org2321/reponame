import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import chalk from "chalk";
import { Api } from "@core/types";
import { findCliUser, logAndExitIfActionFailed } from "../../lib/args";
import { authz, graphTypes } from "@core/lib/graph";
import * as R from "ramda";
import { autoModeOut, getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["rename [user] [new-name]"];
export const desc = "Rename an existing CLI ENVKEY user.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("user", {
      type: "string",
      describe: "CLI user name or id",
    })
    .positional("new-name", {
      type: "string",
      describe: "New name for the CLI user",
    });
export const handler = async (
  argv: BaseArgs & { user?: string; "new-name"?: string }
): Promise<void> => {
  const prompt = getPrompt();
  const { state, auth } = await initCore(argv, true);
  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }

  const userName = (argv.user ??
    (
      await prompt<{ user: string }>({
        type: "select",
        name: "user",
        message: "CLI user to rename:",
        initial: 0,
        choices: authz
          .getRenameableCliUsers(state.graph, auth.userId)
          .map((cliUser) => ({
            name: cliUser.id,
            message: `${chalk.bold(cliUser.name)}`,
          })),
      })
    ).user) as string;

  const cliUser = findCliUser(state.graph, userName);
  if (!cliUser) {
    return exit(1, chalk.red.bold("CLI user not found, or is deactivated"));
  }

  const name =
    argv["new-name"] ??
    (
      await prompt<{ name: string }>({
        type: "input",
        name: "name",
        message: "New CLI user name:",
      })
    ).name;
  const alreadyExistsByName = graphTypes(state.graph)
    .cliUsers.filter((u) => !u.deactivatedAt)
    .find(R.propEq("name", name));
  if (alreadyExistsByName) {
    return exit(1, chalk.red.bold("A CLI User already exists with that name!"));
  }
  if (!authz.canRenameCliUser(state.graph, auth.userId, cliUser.id)) {
    return exit(
      1,
      chalk.red.bold("You do not have permission to delete the CLI user!")
    );
  }

  const res = await dispatch({
    type: Api.ActionType.RENAME_CLI_USER,
    payload: {
      id: cliUser.id,
      name,
    },
  });

  await logAndExitIfActionFailed(
    res,
    `Renaming the CLI user ${cliUser.name} failed`
  );

  console.log(
    chalk.bold(
      `The CLI user ${chalk.bold(
        cliUser.name
      )} was successfully renamed to ${chalk.bold(name)}.`
    )
  );
  autoModeOut({ id: cliUser.id, name });

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

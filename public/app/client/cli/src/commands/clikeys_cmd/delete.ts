import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import chalk from "chalk";
import { Api } from "@core/types";
import { findCliUser, logAndExitIfActionFailed } from "../../lib/args";
import { authz } from "@core/lib/graph";
import { getPrompt } from "../../lib/console_io";
import {tryApplyEnvkeyOverride} from "../../envkey_detection";

export const command = ["delete [user]", "rm [user]"];
export const desc = "Completely remove access for a CLI ENVKEY.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("user", {
      type: "string",
      describe: "CLI user name or id",
    })
    .option("force", {
      type: "boolean",
      alias: "f",
      describe: "Auto-confirm",
    });
export const handler = async (
  argv: BaseArgs & { user?: string; force?: boolean }
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
        message: "CLI user to remove:",
        initial: 0,
        choices: authz
          .getDeletableCliUsers(state.graph, auth.userId)
          .map((cliUser) => ({
            name: cliUser.id,
            message: `${chalk.bold(cliUser.name)}`,
          })),
      })
    ).user) as string;

  const cliUser = findCliUser(state.graph, userName);
  if (!cliUser) {
    return exit(1, chalk.red.bold("CLI user not found, or is deactivated."));
  }
  if (!authz.canDeleteCliUser(state.graph, auth.userId, cliUser.id)) {
    return exit(
      1,
      chalk.red.bold("You do not have permission to delete the CLI user!")
    );
  }
  if (!argv.force) {
    const { confirm } = await prompt<{ confirm: boolean }>({
      type: "confirm",
      name: "confirm",
      message: chalk.bold(
        `Delete CLI user ${cliUser.name}? This action cannot be reversed!`
      ),
    });

    if (!confirm) {
      console.log(chalk.bold("CLI user deletion aborted!"));
      return exit();
    }
  }

  const res = await dispatch({
    type: Api.ActionType.DELETE_CLI_USER,
    payload: {
      id: cliUser.id,
    },
  });

  await logAndExitIfActionFailed(
    res,
    `Deleting the CLI user ${cliUser.name} failed`
  );

  console.log(
    chalk.bold(`Deleting the CLI user ${cliUser.name} was successful.`)
  );

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

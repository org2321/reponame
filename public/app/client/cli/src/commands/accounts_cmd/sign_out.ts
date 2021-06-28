import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { BaseArgs } from "../../types";
import { authFromEmail, chooseAccount } from "../../lib/auth";
import { dispatch, initCore } from "../../lib/core";
import { Client } from "@core/types";
import chalk from "chalk";

export const command = ["sign-out", "logout"];
export const desc = "Sign out of a session on this device.";
export const builder = (yargs: Argv<BaseArgs>) => yargs;
export const handler = async (argv: BaseArgs): Promise<void> => {
  const { state } = await initCore(argv, false),
    accounts = (Object.values(
      state.orgUserAccounts
    ) as Client.ClientUserAuth[]).filter(({ token }) => Boolean(token));

  if (accounts.length == 0) {
    console.log(chalk.red.bold(`You are not signed in. No work was done.`));
    return exit();
  }

  let authToSignOut: Client.ClientUserAuth | undefined;

  if (argv.account) {
    authToSignOut = await authFromEmail(
      state,
      argv.account,
      argv.org,
      accounts
    );
  } else if (state.defaultAccountId) {
    authToSignOut = state.orgUserAccounts[state.defaultAccountId];
  } else if (accounts.length == 1) {
    authToSignOut = accounts[0];
  } else {
    authToSignOut = await chooseAccount(state, true, false);
  }

  if (!authToSignOut) {
    console.log(chalk.red.bold(`You are not signed in. No work was done.`));
    return exit();
  }

  const res = await dispatch(
    {
      type: Client.ActionType.SIGN_OUT,
      payload: { accountId: authToSignOut.userId },
    },
    authToSignOut.userId
  );

  if (!res.success) {
    console.log();
    const err = (res.resultAction as any).payload?.error;
    return exit(1, chalk.red.bold(`Signing out failed!`) + err);
  }

  console.log(chalk.green.bold(`Signout was successful.`));
  return exit();
};

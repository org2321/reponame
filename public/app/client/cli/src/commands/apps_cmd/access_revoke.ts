import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { BaseArgs } from "../../types";
import { initCore, dispatch } from "../../lib/core";
import { authz } from "@core/lib/graph";

import { Api, Model } from "@core/types";
import chalk from "chalk";
import {
  findApp,
  findUser,
  logAndExitIfActionFailed,
  requireUserAppRoleAndGrant,
} from "../../lib/args";
import * as R from "ramda";
import { getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = [
  "access-revoke [app] [user_email]",
  "revoke [app] [user_email]",
];
export const desc = "Remove app access for a collaborator.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("app", { type: "string", describe: "app name" })
    .positional("user_email", { type: "string", describe: "user email" });
export const handler = async (
  argv: BaseArgs & { app?: string; user_email?: string }
): Promise<void> => {
  const prompt = getPrompt();
  const { state, auth } = await initCore(argv, true);
  let app: Model.App | undefined;
  let userEmail: string | undefined = argv["user_email"];

  if (argv["app"]) {
    app = findApp(state.graph, argv["app"]);
  }

  // detection from ENVKEY
  if (!app) {
    if (tryApplyEnvkeyOverride(auth.userId, argv)) {
      return handler(argv);
    }
    const appId = argv["detectedEnvkey"]?.appId?.toLowerCase();
    if (appId) {
      const userEmailIsFirst = argv["app"]?.includes("@");
      const otherArgsValid = !argv["app"] || userEmailIsFirst;
      if (otherArgsValid) {
        app = state.graph[appId] as Model.App | undefined;
        if (app) {
          console.log("Detected app", chalk.bold(app.name), "\n");
          // shuffle left
          if (userEmailIsFirst) {
            userEmail = argv["app"];
          }
        }
      }
    }
  }

  // choose an app
  if (!app) {
    const appChoices = R.sortBy(
      R.prop("name"),
      authz.getAccessRemoveableApps(state.graph, auth.userId).map((a) => ({
        name: a.name,
        message: chalk.bold(a.name),
      }))
    );
    if (!appChoices.length) {
      console.log(
        chalk.bold("There are no apps for which you may revoke user access.")
      );
      return exit();
    }

    const appName = (argv.app ??
      (
        await prompt<{ app: string }>({
          type: "select",
          name: "app",
          message: "App:",
          choices: appChoices,
        })
      ).app) as string;
    app = findApp(state.graph, appName);
  }

  if (!app) {
    return exit(1, chalk.red.bold("App not found"));
  }

  if (!userEmail) {
    const revokableUsers = R.sortBy(
      R.prop("message"),
      authz
        .getAccessRemoveableUsersForApp(state.graph, auth.userId, app.id)
        .map((u) => ({
          name: u.id,
          message:
            u.type === "cliUser"
              ? `CLI - ${u.name}`
              : `${u.email} - ${u.firstName} ${u.lastName}`,
        }))
    );
    if (!revokableUsers.length) {
      return exit(
        1,
        chalk.red.bold("No users are available for which to remove access.")
      );
    }
    userEmail = (
      await prompt<{ user_email: string }>({
        type: "select",
        name: "user_email",
        message: "User:",
        choices: revokableUsers,
      })
    ).user_email as string;
  }

  const user = findUser(state.graph, userEmail!);
  if (!user) {
    return exit(1, chalk.red.bold("User not found"));
  }
  const appUserGrant = requireUserAppRoleAndGrant(state.graph, app.id, user.id);
  const res = await dispatch({
    type: Api.ActionType.REMOVE_APP_ACCESS,
    payload: {
      id: appUserGrant.id,
    },
  });

  await logAndExitIfActionFailed(
    res,
    "Failed removing user's app access grant!"
  );

  console.log(chalk.bold("Access was was removed successfully."));

  return exit();
};

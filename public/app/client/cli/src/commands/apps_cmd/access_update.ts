import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { initCore, dispatch } from "../../lib/core";
import { BaseArgs } from "../../types";
import { Client, Model, Rbac } from "@core/types";
import { authz } from "@core/lib/graph";
import chalk from "chalk";
import {
  findApp,
  findUser,
  getAppRoleInviteChoices,
  logAndExitIfActionFailed,
  requireUserAppRoleAndGrant,
} from "../../lib/args";
import * as R from "ramda";
import { autoModeOut, getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["access-update [app] [user_email] [app_role_id]"];
export const desc = "Change the app role of a user.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("app", { type: "string", describe: "app name" })
    .positional("user_email", { type: "string", describe: "user email" })
    .positional("app_role_id", { type: "string", describe: "app role id" });
export const handler = async (
  argv: BaseArgs & { app?: string; user_email?: string; app_role_id?: string }
): Promise<void> => {
  const prompt = getPrompt();
  const { state, auth } = await initCore(argv, true);
  let app: Model.App | undefined;
  let userEmail: string | undefined = argv["user_email"];
  let appRoleId: string | undefined = argv["app_role_id"];

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
            if (argv["user_email"]) {
              appRoleId = argv["user_email"];
            }
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
      return exit(
        1,
        chalk.red.bold("Create an app before adding user access.")
      );
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

  const updateableUsers = R.sortBy(
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
  if (!updateableUsers.length) {
    return exit(
      1,
      chalk.red.bold("No users are available for app access updates.")
    );
  }

  const userName = (userEmail ??
    (
      await prompt<{ user_email: string }>({
        type: "select",
        name: "user_email",
        message: "User:",
        choices: updateableUsers,
      })
    ).user_email) as string;
  const user = findUser(state.graph, userName);
  if (!user) {
    return exit(1, chalk.red.bold("User not found"));
  }

  requireUserAppRoleAndGrant(state.graph, app.id, user.id);

  if (!appRoleId) {
    appRoleId = (
      await prompt<{ app_role_id: string }>({
        type: "select",
        name: "app_role_id",
        message: "App Role:",
        choices: getAppRoleInviteChoices(
          state.graph,
          app.id,
          auth.userId,
          user.id
        ),
      })
    ).app_role_id as string;
  }
  const appRole = state.graph[appRoleId] as Rbac.AppRole;
  if (!appRole) {
    return exit(1, chalk.red.bold("App role not found"));
  }

  const res = await dispatch({
    type: Client.ActionType.GRANT_APPS_ACCESS,
    payload: [
      {
        appId: app.id,
        appRoleId: appRole.id,
        userId: user.id,
      },
    ],
  });

  await logAndExitIfActionFailed(
    res,
    "Failed changing the user access to the app role!"
  );

  console.log(chalk.bold("App role access was updated successfully."));
  autoModeOut({
    id: (res.resultAction as any)?.id,
    appId: app.id,
    appRoleId: appRole.id,
    appRoleName: appRole.name,
    userId: user.id,
  });

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

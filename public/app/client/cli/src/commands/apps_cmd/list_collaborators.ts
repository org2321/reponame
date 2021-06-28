import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { BaseArgs } from "../../types";
import { initCore } from "../../lib/core";
import chalk from "chalk";
import { findApp, getAppChoices } from "../../lib/args";
import Table from "cli-table3";
import { getAppRoleForUserOrInvitee, graphTypes } from "@core/lib/graph";
import * as R from "ramda";
import { autoModeOut, getPrompt } from "../../lib/console_io";
import { Model } from "@core/types";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["list-collaborators [app]", "access [app]"];
export const desc = "List users with access to a specific app.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs.positional("app", { type: "string", describe: "app name" });
export const handler = async (
  argv: BaseArgs & { app?: string }
): Promise<void> => {
  const prompt = getPrompt();
  const { state, auth } = await initCore(argv, true);
  let app: Model.App | undefined;

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
      const otherArgsValid = !argv["app"];
      if (otherArgsValid) {
        app = state.graph[appId] as Model.App | undefined;
        if (app) {
          console.log("Detected app", chalk.bold(app.name), "\n");
        }
      }
    }
  }

  if (!app) {
    const appChoices = getAppChoices(state.graph);
    if (!appChoices.length) {
      console.log(
        chalk.bold("Create an app before listing app collaborators.")
      );
      return exit();
    }
    const appName = (
      await prompt<{ app: string }>({
        type: "select",
        name: "app",
        message: "App:",
        choices: appChoices,
      })
    ).app as string;
    app = findApp(state.graph, appName);
  }

  if (!app) {
    return exit(1, chalk.red.bold("App not found"));
  }
  console.log(`Users with access to ${chalk.bold(app.name)}:`);

  const table = new Table();
  let orgUsersDisplay: any[] = [];
  let cliUsersDisplay: any[] = [];
  for (let user of R.sortBy(
    R.prop("email"),
    graphTypes(state.graph).orgUsers
  )) {
    const appRole = getAppRoleForUserOrInvitee(state.graph, app.id, user.id);
    if (!appRole) continue;

    table.push([
      chalk.bold(user.email),
      [user.firstName, user.lastName].join(" "),
      chalk.bold(appRole.name),
    ]);

    orgUsersDisplay.push({
      id: user.id,
      email: user.email,
      appRoleId: appRole.id,
      appRoleName: appRole.name,
    });
  }
  for (let cliUser of R.sortBy(
    R.prop("name"),
    graphTypes(state.graph).cliUsers
  )) {
    const appRole = getAppRoleForUserOrInvitee(state.graph, app.id, cliUser.id);
    if (!appRole) continue;

    table.push([chalk.bold(cliUser.name), "CLI", chalk.bold(appRole.name)]);

    cliUsersDisplay.push({
      id: cliUser.id,
      name: cliUser.name,
      appRoleId: appRole.id,
      appRoleName: appRole.name,
    });
  }

  console.log(table.toString());
  autoModeOut({ orgUsers: orgUsersDisplay, cliUsers: cliUsersDisplay });
  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

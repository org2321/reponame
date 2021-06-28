import chalk from "chalk";
import * as R from "ramda";
import Table from "cli-table3";
import { getEnvironmentTree } from "../../lib/envs";
import { authz, graphTypes, getAppRoleForUserOrInvitee } from "@core/lib/graph";
import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { Api } from "@core/types";
import { logAndExitIfActionFailed } from "../../lib/args";
import { getPrompt, autoModeOut } from "../../lib/console_io";
import {tryApplyEnvkeyOverride} from "../../envkey_detection";

export const command = "create [name]";
export const desc = "Create a new app";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs.positional("name", { type: "string", describe: "app name" });
export const handler = async (
  argv: BaseArgs & { name: string | undefined }
): Promise<void> => {
  const prompt = getPrompt();
  let { state, auth } = await initCore(argv, true);
  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }
  if (!authz.canCreateApp(state.graph, auth.userId)) {
    return exit(1, chalk.red.bold("You do not have permission to create an app."));
  }
  const name =
    argv.name ??
    (
      await prompt<{ name: string }>({
        type: "input",
        name: "name",
        message: "App name:",
      })
    ).name;

  const res = await dispatch({
    type: Api.ActionType.CREATE_APP,
    payload: {
      name,
      settings: {
        autoCaps: true,
      },
    },
  });

  await logAndExitIfActionFailed(res, `Creating the app ${name} failed!`);

  console.log(chalk.bold("App created!\n"));

  state = res.state;

  const newApp = graphTypes(state.graph).apps.filter(
      R.propEq("createdAt", state.graphUpdatedAt)
    )[0],
    role = getAppRoleForUserOrInvitee(state.graph, newApp.id, auth.userId);

  const table = new Table({
    colWidths: [15, 40],
  });

  table.push(
    ["App Name", chalk.bold(newApp.name)],
    ["Your Role", chalk.bold(role!.name)],
    ["Environments", chalk.bold(getEnvironmentTree(state.graph, newApp.id))]
  );

  console.log(table.toString());
  console.log("");

  console.log(
    `Use ${chalk.bold("envkey set")} to set config values or ${chalk.bold(
      "envkey apps grant"
    )} to give users access.`
  );

  autoModeOut({ name: newApp.name, id: newApp.id });
  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

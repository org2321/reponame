import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { authz, graphTypes } from "@core/lib/graph";
import { Api, Model } from "@core/types";
import chalk from "chalk";
import {
  findApp,
  findServer,
  getAppChoices,
  getServerChoices,
  logAndExitIfActionFailed,
} from "../../lib/args";
import { getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["delete [app] [server]", "rm [app] [server]"];
export const desc = "Delete a server ENVKEY.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("app", { type: "string", describe: "app name" })
    .positional("server", {
      type: "string",
      describe: "server name",
    })
    .option("force", {
      type: "boolean",
      alias: "f",
      describe: "Auto-confirm",
    });
export const handler = async (
  argv: BaseArgs & { app?: string; server?: string; force?: boolean }
): Promise<void> => {
  const prompt = getPrompt();
  let { state, auth } = await initCore(argv, true);
  let app: Model.App | undefined;
  let server: Model.Server | undefined;
  let serverName: string | undefined = argv["server"];

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
      const firstKeyName =
        argv["app"] &&
        Boolean(
          graphTypes(state.graph).servers.find((k) =>
            [k.name, k.id].includes(argv["app"]!)
          )
        );
      const otherArgsValid = !argv["app"] || firstKeyName;
      if (otherArgsValid) {
        app = state.graph[appId] as Model.App | undefined;
        if (app) {
          console.log("Detected app", chalk.bold(app.name), "\n");
          if (firstKeyName) {
            // shift left
            serverName = argv["app"];
          }
        }
      }
    }
  }

  if (!app) {
    const appName = (argv.app ??
      (
        await prompt<{ app: string }>({
          type: "select",
          name: "app",
          message: "App name:",
          choices: getAppChoices(state.graph),
        })
      ).app) as string;
    app = findApp(state.graph, appName);
  }

  if (!app) {
    return exit(1, chalk.red.bold(`App not found, or you do not have access.`));
  }
  const { servers } = graphTypes(state.graph);
  if (!servers.length) {
    console.error(chalk.bold(`No servers exist for the app ${app.name}.`));
    return exit();
  }
  if (!serverName) {
    serverName = (
      await prompt<{ server_name: string }>({
        type: "select",
        name: "server_name",
        message: "Server name:",
        initial: 0,
        choices: getServerChoices(state.graph, app.id),
      })
    ).server_name as string;
  }
  // allow deleting by name or id
  server = findServer(state.graph, app.id, serverName);

  if (!server) {
    return exit(
      1,
      chalk.red.bold(
        `Server ${chalk.bold(serverName)} not found for app ${chalk.bold(
          app.name
        )}, or you do not have access.`
      )
    );
  }

  if (!authz.canDeleteServer(state.graph, auth.userId, server.id)) {
    return exit(
      1,
      chalk.red("You do not have permission to delete the server.")
    );
  }

  if (!argv.force) {
    const { confirm } = await prompt<{ confirm: boolean }>({
      type: "confirm",
      name: "confirm",
      message: chalk.bold(
        `Delete ${server.name}? This action cannot be reversed! Consider revoking or renewing the key.`
      ),
    });

    if (!confirm) {
      console.log(chalk.bold("Server deletion aborted!"));
      return exit();
    }
  }

  const res = await dispatch({
    type: Api.ActionType.DELETE_SERVER,
    payload: {
      id: server.id,
    },
  });

  await logAndExitIfActionFailed(res, "Deleting the server failed!");

  console.log(chalk.bold(`Server ${server.name} (${server.id}) was deleted!`));

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

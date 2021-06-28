import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { authz, getEnvironmentName, graphTypes } from "@core/lib/graph";
import { Api, Model } from "@core/types";
import chalk from "chalk";
import * as R from "ramda";
import {
  findApp,
  findServer,
  getAppChoices,
  logAndExitIfActionFailed,
} from "../../lib/args";
import { getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["revoke [app] [server]"];
export const desc =
  "Disable a server ENVKEY. It must be renewed before using again.";
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
  argv: BaseArgs & { app?: string; server?: string }
): Promise<void> => {
  const prompt = getPrompt();
  const { state, auth } = await initCore(argv, true);
  let app: Model.App | undefined;
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
    const appName = (
      await prompt<{ app: string }>({
        type: "select",
        name: "app",
        message: "App name:",
        choices: getAppChoices(state.graph),
      })
    ).app as string;
    app = findApp(state.graph, appName);
  }
  if (!app) {
    return exit(1, chalk.red.bold(`App not found, or you do not have access.`));
  }

  if (!serverName) {
    serverName = (
      await prompt<{ server_name: string }>({
        type: "select",
        name: "server_name",
        message: "Server name:",
        initial: 0,
        choices: graphTypes(state.graph)
          .servers.filter(R.propEq("appId", app.id))
          .sort(R.ascend(R.prop("environmentId")))
          .map((s) => ({
            name: s.name,
            message: `${s.name} (${getEnvironmentName(
              state.graph,
              s.environmentId
            )})`,
          })),
      })
    ).server_name as string;
  }

  const server = findServer(state.graph, app.id, serverName);
  if (!server) {
    return exit(
      1,
      chalk.red(
        `Server ${chalk.bold(serverName)} not found for app ${chalk.bold(
          app.name
        )}, or you do not have access.`
      )
    );
  }

  const generatedKey = graphTypes(state.graph).generatedEnvkeys.find(
    (k) => k.keyableParentId === server.id
  );
  if (!generatedKey) {
    console.log(
      `The key for server ${chalk.bold(
        serverName
      )} has already been revoked, or you do not have access.`
    );
    return exit();
  }

  if (
    !authz.canRevokeKey(state.graph, auth.userId, {
      generatedEnvkeyId: generatedKey.id,
    })
  ) {
    return exit(
      1,
      chalk.red("You do not have permission to revoke the server key.")
    );
  }

  const res = await dispatch({
    type: Api.ActionType.REVOKE_KEY,
    payload: {
      id: generatedKey.id,
    },
  });
  await logAndExitIfActionFailed(
    res,
    `Revoking the server key for ${chalk.bold(server.name)} failed!`
  );

  console.log(
    chalk.bold(`The server key for ${server.name} revoked successfully.`)
  );

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

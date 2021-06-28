import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import {
  authz,
  getEnvironmentName,
  graphTypes,
  getActiveGeneratedEnvkeysByKeyableParentId,
} from "@core/lib/graph";
import { Client, Model } from "@core/types";
import chalk from "chalk";
import Table from "cli-table3";
import clipboardy from "clipboardy";
import {
  findApp,
  findServer,
  getAppChoices,
  getServerChoices,
  logAndExitIfActionFailed,
} from "../../lib/args";
import { autoModeOut, getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";
// old module
const notifier = require("node-notifier");

export const command = ["renew [app] [server]"];
export const desc = "Regenerate a server ENVKEY.";
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
  const now = Date.now();
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

  const serverChoices = getServerChoices(state.graph, app.id);
  if (!serverChoices.length) {
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
        choices: serverChoices,
      })
    ).server_name as string;
  }
  server = findServer(state.graph, app.id, serverName);
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

  let envkeyShortOriginalDisplay: string;
  const existingKey = graphTypes(state.graph).generatedEnvkeys.find(
    (k) => k.keyableParentId === server!.id
  );
  if (existingKey) {
    envkeyShortOriginalDisplay = `${existingKey.envkeyShort}****`;
  } else {
    envkeyShortOriginalDisplay = "<revoked>";
  }

  if (!authz.canGenerateKey(state.graph, auth.userId, server!.id)) {
    return exit(
      1,
      chalk.red("You do not have permission to renew the server key.")
    );
  }

  if (!existingKey) {
    const numActive = Object.values(getActiveGeneratedEnvkeysByKeyableParentId)
      .length;
    const license = graphTypes(state.graph).license;
    const licenseExpired = license.expiresAt != -1 && now > license.expiresAt;
    if (numActive >= license.maxDevices || licenseExpired) {
      let message =
        chalk.red(
          licenseExpired
            ? `Your org's ${
                license.provisional ? "provisional " : ""
              }license has expired.`
            : `Your org has reached its limit of ${license.maxEnvkeys} ENVKEYs.`
        ) + "\n";
      if (
        authz.hasOrgPermission(state.graph, auth.userId, "org_manage_billing")
      ) {
        message += `To generate a new ENVKEY, ${
          licenseExpired ? "renew" : "upgrade"
        } your org's license.`;
      } else {
        message += `To generate a new ENVKEY, ask an admin to ${
          licenseExpired ? "renew" : "upgrade"
        } your org's license.`;
      }

      return exit(1, message);
    }
  }

  if (!argv.force) {
    const { confirm } = await prompt<{ confirm: boolean }>({
      type: "confirm",
      name: "confirm",
      message: chalk.bold(`Renew the key for server ${server.name}?`),
    });

    if (!confirm) {
      console.log(chalk.bold("Server renew aborted!"));
      return exit();
    }
  }

  const res = await dispatch({
    type: Client.ActionType.GENERATE_KEY,
    payload: {
      appId: app.id,
      keyableParentId: server.id,
      keyableParentType: server.type,
    },
  });

  await logAndExitIfActionFailed(res, "Renewing the server key failed!");

  state = res.state;

  const { envkeyIdPart, encryptionKey } = state.generatedEnvkeys[server.id];
  const fullKey = [
    envkeyIdPart,
    encryptionKey,
    auth.hostType == "self-hosted" ? auth.hostUrl : undefined,
  ]
    .filter(Boolean)
    .join("-");

  const table = new Table({
    colWidths: [15, 60],
  });

  table.push(
    ["Name:", chalk.bold(server.name)],
    ["App:", chalk.bold(app.name)],
    [
      "Environment:",
      chalk.bold(getEnvironmentName(state.graph, server.environmentId)),
    ],
    ["Old Key:", `ENVKEY=${chalk.bold(envkeyShortOriginalDisplay)}`]
  );

  console.log(
    chalk.bold(
      "Server key renewed! It will not be shown again, so be sure to save it somewhere safe."
    )
  );
  console.log(table.toString());
  console.log("New Server Key:", `\nENVKEY=${chalk.bold(fullKey)}`);
  autoModeOut({ serverKey: fullKey, id: server.id, appId: app.id });

  clipboardy.writeSync(fullKey);
  notifier.notify("The new server envkey has been copied to clipboard.");

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

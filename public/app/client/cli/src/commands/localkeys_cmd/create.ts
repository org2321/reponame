import clipboardy from "clipboardy";
import * as R from "ramda";
import {
  authz,
  graphTypes,
  getEnvironmentName,
  getEnvironmentsByEnvParentId,
  getActiveGeneratedEnvkeysByKeyableParentId,
} from "@core/lib/graph";
import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { Client, Model } from "@core/types";
import chalk from "chalk";
import Table from "cli-table3";
import { EnvironmentRole } from "@core/types/rbac";
import {
  findApp,
  findEnvironmentWithSubIfDefinedOrError,
  getEnvironmentChoices,
  logAndExitIfActionFailed,
} from "../../lib/args";
import { Graph } from "@core/types/client/graph";
import { autoModeOut, getPrompt } from "../../lib/console_io";
import {
  firstArgIsEnvironment,
  tryApplyEnvkeyOverride,
} from "../../envkey_detection";

// old module
const notifier = require("node-notifier");

export const command = ["create [app] [environment] [key-name]"];
export const desc = "Create a new local ENVKEY.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("key-name", {
      type: "string",
      describe: "local key name",
    })
    .positional("app", { type: "string", describe: "app name" })
    .positional("environment", {
      type: "string",
      describe: "environment name",
      coerce: R.toLower,
    })
    .option("sub-environment", {
      type: "string",
      alias: "s",
      describe: "sub-environment when environment is a parent",
      coerce: R.toLower,
    });
export const handler = async (
  argv: BaseArgs & {
    app?: string;
    environment?: string;
    "sub-environment"?: string;
    "key-name"?: string;
  }
): Promise<void> => {
  const prompt = getPrompt();
  const now = Date.now();
  let { state, auth } = await initCore(argv, true);
  let app: Model.App | undefined;
  let environmentNameArg: string | undefined = argv["environment"];
  let environmentName: string | undefined;
  let environmentId: string | undefined;
  let appEnv: Model.Environment | undefined;
  let keyName: string | undefined = argv["key-name"];

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
      const firstEnv = firstArgIsEnvironment(state.graph, appId, argv["app"]);
      const otherArgsValid = !argv["app"] || firstEnv;
      if (otherArgsValid) {
        app = state.graph[appId] as Model.App | undefined;
        if (app) {
          console.log("Detected app", chalk.bold(app.name), "\n");
          if (firstEnv) {
            // shift left
            environmentNameArg = argv["app"];
            keyName = argv["environment"];
          }
        }
      }
    }
  }

  // license check
  const numActive = Object.values(
    getActiveGeneratedEnvkeysByKeyableParentId(state.graph)
  ).length;
  const license = graphTypes(state.graph).license;
  const licenseExpired = license.expiresAt != -1 && now > license.expiresAt;
  if (numActive >= license.maxDevices || licenseExpired) {
    let message = chalk.red(
      licenseExpired
        ? `Your org's ${
            license.provisional ? "provisional " : ""
          }license has expired.`
        : `Your org has reached its limit of ${license.maxEnvkeys} ENVKEYs.`
    );
    if (
      authz.hasOrgPermission(state.graph, auth.userId, "org_manage_billing")
    ) {
      message += `To create more local keys, ${
        licenseExpired ? "renew" : "upgrade"
      } your org's license.`;
    } else {
      message += `To create more local keys, ask an admin to ${
        licenseExpired ? "renew" : "upgrade"
      } your org's license.`;
    }

    return exit(1, message);
  }

  if (!app) {
    const appChoices = R.sortBy(
      R.prop("message"),
      authz
        .getAppsPassingEnvTest(
          state.graph,
          auth.userId,
          authz.canCreateLocalKey
        )
        .map((a) => ({
          name: a.id,
          message: chalk.bold(a.name),
        }))
    );
    if (!appChoices.length) {
      return exit(
        1,
        chalk.red(
          "There are no apps for which you have permission to create a local key."
        )
      );
    }

    const appName = (
      await prompt<{ app: string }>({
        type: "select",
        name: "app",
        message: "Select app:",
        initial: 0,
        choices: appChoices,
      })
    ).app as string;
    app = findApp(state.graph, appName);
  }

  if (!app) {
    return exit(
      1,
      chalk.red.bold("App does not exist, or you do not have access.")
    );
  }

  if (environmentNameArg) {
    environmentId = findEnvironmentWithSubIfDefinedOrError(
      state.graph,
      app.id,
      environmentNameArg,
      argv["sub-environment"]
    );
  }

  // user may have passed in an environment, and/or a sub-environment, or environment name
  // that is duplicated - thus we need to prompt them
  environmentName = (environmentId ??
    (await promptEnvironment(state.graph, auth.userId, app.id))) as string;
  const appEnvironments =
    getEnvironmentsByEnvParentId(state.graph)[app.id] ?? [];

  const appEnvs = appEnvironments.filter((env) => {
    const envName = getEnvironmentName(state.graph, env.id) as string;
    const role = state.graph[env.environmentRoleId] as EnvironmentRole;
    return (
      envName.toLowerCase() === environmentName!.toLowerCase() ||
      env.id === environmentName ||
      role.id === environmentName
    );
  });
  if (!appEnvs.length) {
    return exit(
      1,
      chalk.red(
        `Environment ${chalk.bold(
          environmentName
        )} does not exist, or you do not have access.`
      )
    );
  }
  if (appEnvs.length === 1) {
    appEnv = appEnvs[0];
  } else {
    console.log("There is more than one environment with that name.");
    appEnv = state.graph[
      await promptEnvironment(state.graph, auth.userId, app.id)
    ] as Model.Environment;
  }

  const envRole = state.graph[appEnv.environmentRoleId] as EnvironmentRole;
  if (!envRole.hasLocalKeys) {
    return exit(
      1,
      chalk.red(
        `Environment role ${chalk.bold(
          envRole.name
        )} does not allow local keys.`
      )
    );
  }

  if (!authz.canCreateLocalKey(state.graph, auth.userId, appEnv.id)) {
    return exit(
      1,
      chalk.red(
        "You are not allowed to create a local key for the app and environment."
      )
    );
  }

  const environmentHasAKey =
    graphTypes(state.graph).localKeys.filter(
      R.propEq("environmentId", appEnv.id)
    ).length > 0;
  if (!keyName) {
    keyName = (
      await prompt<{ key_name: string }>({
        type: "input",
        name: "key_name",
        message: "New local key name:",
        initial: environmentHasAKey ? "" : `Default ${envRole.name} Key`,
      })
    ).key_name as string;
  }

  const keyNameExists = !!graphTypes(state.graph).localKeys.find(
    R.whereEq({ appId: app.id, name: keyName })
  );
  if (keyNameExists) {
    return exit(
      1,
      chalk.red.bold("A local key already exists with that name for the app.")
    );
  }

  const res = await dispatch({
    type: Client.ActionType.CREATE_LOCAL_KEY,
    payload: {
      name: keyName!,
      appId: app.id,
      environmentId: appEnv.id,
    },
  });

  await logAndExitIfActionFailed(res, "Creating the local key failed!");

  state = res.state;

  const newLocalKey = graphTypes(state.graph).localKeys.find(
    R.whereEq({ appId: app.id, environmentId: appEnv.id, name: keyName })
  );
  if (!newLocalKey) {
    return exit(1, chalk.bold("Error fetching new local key!"));
  }

  const { envkeyIdPart, encryptionKey } = state.generatedEnvkeys[
    newLocalKey.id
  ];
  let fullKey = [
    envkeyIdPart,
    encryptionKey,
    auth.hostType == "self-hosted" ? auth.hostUrl : undefined,
  ]
    .filter(Boolean)
    .join("-");

  const table = new Table({
    colWidths: [15, 60],
  });

  const possibleParentName =
    appEnv.isSub && appEnv.parentEnvironmentId
      ? `${getEnvironmentName(state.graph, appEnv.parentEnvironmentId)} > `
      : "";
  table.push(
    ["Name:", chalk.bold(newLocalKey.name)],
    ["App:", chalk.bold(app.name)],
    [
      "Environment:",
      possibleParentName +
        chalk.bold(getEnvironmentName(state.graph, appEnv.id)),
    ]
  );

  console.log(
    chalk.bold(
      "Local key generated! It will not be shown again, so be sure to save it somewhere safe."
    )
  );
  console.log(table.toString());
  console.log("Local Key:", `\nENVKEY=${chalk.bold(fullKey)}`);
  autoModeOut({ localKey: fullKey, id: newLocalKey.id, appId: app.id });

  clipboardy.writeSync(fullKey);
  notifier.notify("The new local envkey has been copied to clipboard.");

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

const promptEnvironment = (
  graph: Graph.UserGraph,
  currentUserId: string,
  appId: string
) =>
  getPrompt()<{ environment: string }>({
    type: "select",
    name: "environment",
    message: "Select app environment:",
    initial: 0,
    choices: getEnvironmentChoices(graph, currentUserId, appId, "localKey"),
  }).then(R.prop("environment"));

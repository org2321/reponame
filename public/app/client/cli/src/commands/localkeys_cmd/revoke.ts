import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { authz, graphTypes } from "@core/lib/graph";
import { Api, Model } from "@core/types";
import chalk from "chalk";
import * as R from "ramda";
import {
  findApp,
  findKeyableParent,
  getAppChoices,
  getLocalKeyChoices,
  logAndExitIfActionFailed,
} from "../../lib/args";
import { getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["revoke [app] [key-name]"];
export const desc =
  "Disable a local ENVKEY. The key must be renewed before using again.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("app", { type: "string", describe: "app name" })
    .positional("key-name", {
      type: "string",
      describe: "local key name",
    });
export const handler = async (
  argv: BaseArgs & { app?: string; "key-name"?: string }
): Promise<void> => {
  const prompt = getPrompt();
  const { state, auth } = await initCore(argv, true);
  let app: Model.App | undefined;
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
      const firstKeyName =
        argv["app"] &&
        Boolean(
          graphTypes(state.graph).localKeys.find((k) =>
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
            keyName = argv["app"];
          }
        }
      }
    }
  }

  if (!app) {
    const appChoices = R.sortBy(
      R.prop("message"),
      authz
        .getAppsPassingKeyableTest(
          state.graph,
          auth.userId,
          (graph, currentUserId, keyableParentId) =>
            authz.canRevokeKey(graph, currentUserId, { keyableParentId })
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
          "There are no apps for which you have permission to revoke a local key."
        )
      );
    }

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
  const { localKeys } = graphTypes(state.graph);
  if (!localKeys.length) {
    console.error(chalk.bold(`No local keys exist for the app ${app.name}.`));
    return exit();
  }
  if (!keyName) {
    keyName = (
      await prompt<{ key_name: string }>({
        type: "select",
        name: "key_name",
        message: "Local key name:",
        initial: 0,
        choices: getLocalKeyChoices(state.graph, app.id),
      })
    ).key_name as string;
  }

  const localKey = findKeyableParent(state.graph, app.id, keyName);
  if (!localKey) {
    return exit(
      1,
      chalk.red.bold(
        `Local key ${chalk.bold(localKey)} not found for app ${chalk.bold(
          app.name
        )}`
      )
    );
  }

  const generatedKey = graphTypes(state.graph).generatedEnvkeys.find(
    (k) => k.keyableParentId === localKey.id
  );
  if (!generatedKey) {
    console.log(
      `The local key ${chalk.bold(keyName)} has already been revoked.`
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
      chalk.red.bold("You do not have permission to revoke the local key!")
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
    `Revoking the local key ${chalk.bold(localKey.name)} failed!`
  );

  console.log(
    chalk.bold(`The local key ${localKey.name} was revoked successfully.`)
  );

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

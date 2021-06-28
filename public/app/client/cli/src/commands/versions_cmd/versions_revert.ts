import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { authz } from "@core/lib/graph";
import { getChangesets, getVersionForChangeset } from "@core/lib/client";
import { Client, Model } from "@core/types";
import chalk from "chalk";
import {
  displayFullEnvName,
  logAndExitIfActionFailed,
  selectPrereqsForVersionCommands,
} from "../../lib/args";
import { fetchChangesetsIfNeeded, getPending } from "../../lib/envs";
import { autoModeOut, getPrompt } from "../../lib/console_io";

export const command = ["revert-to [app-or-block] [environment]"];
export const desc =
  "Revert an environment, and optionally specific keys, to a specific commit or version number.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("app-or-block", { type: "string", describe: "app name" })
    .positional("environment", {
      type: "string",
      describe: "environment name",
      conflicts: ["local-override", "override-user"],
    })
    .option("version-number", {
      type: "number",
      alias: ["ver"],
      describe: "version number to revert the environment to",
    })
    .option("commit-number", {
      type: "number",
      alias: ["commit"],
      describe: "commit number to revert the environment to",
      conflicts: ["version-number"],
    })
    .option("sub-environment", {
      type: "string",
      alias: "s",
      describe: "sub-environment when environment is a parent",
    })
    .option("local-override", {
      type: "boolean",
      alias: ["l", "local-overrides"],
      describe: "View versions for the current user local overrides",
    })
    .option("override-user", {
      type: "string",
      alias: ["u", "override-for-user", "overrides-for-user"],
      describe:
        "View versions for the local overrides of another user (email or id)",
      conflicts: ["local-override"],
      coerce: (value) => {
        if (!value) {
          throw new Error("Missing user override");
        }
        return value;
      },
    })
    .option("keys", {
      type: "string",
      alias: "k",
      describe: "Limit versions to those modifying specific config variables",
    })
    .array("keys")
    .option("ignore-pending", { type: "boolean" });
export const handler = async (
  argv: BaseArgs & {
    "app-or-block"?: string;
    environment?: string;
    "sub-environment"?: string;
    "local-override"?: boolean;
    "override-user"?: string;
    "version-number"?: number;
    "commit-number"?: number;
    "ignore-pending"?: boolean;
    keys?: string[];
  }
): Promise<void> => {
  const prompt = getPrompt();
  let { state, auth } = await initCore(argv, true);
  let appOrBlock: Model.EnvParent;

  if (!argv["version-number"] && !argv["commit-number"]) {
    return exit(1, "Either --version-number or --commit-number is required");
  }

  const [pendingSummary, initialPending] = getPending(state);
  if (initialPending && !argv["ignore-pending"]) {
    console.error(pendingSummary);
    return exit(
      1,
      chalk.red(
        "There are already pending changes, so revert-to commands are disabled.\nEither reset pending changes, or use flag --ignore-pending to continue."
      )
    );
  }

  const result = await selectPrereqsForVersionCommands(
    state,
    auth,
    argv,
    authz.canReadEnv
  );
  ({ state, auth, appOrBlock } = result);

  const envParentId = appOrBlock.id;
  const environmentId = ("appEnv" in result
    ? result.appEnv.id
    : result.localOverrideEnvironmentId) as string;
  const envDescription =
    "appEnv" in result
      ? `- ${chalk.bold(displayFullEnvName(state.graph, result.appEnv.id))}`
      : result.localOverrideEnvironmentId!.includes(auth.userId)
      ? "local overrides"
      : "user overrides";

  const changesetParams = {
    envParentId,
    environmentId,
  } as Client.Env.ListVersionsParams;
  if (argv["keys"]) {
    changesetParams.entryKeys = argv["keys"] as string[];
  }

  state = await fetchChangesetsIfNeeded(state, [envParentId]);

  const versionFromCommit = argv["commit-number"]
    ? getVersionForChangeset(state, changesetParams, argv["commit-number"])
    : undefined;

  const version = (versionFromCommit ??
    argv["version-number"] ??
    parseInt(
      (
        await prompt<{ version: string }>({
          type: "input",
          name: "version",
          required: true,
          message: "Enter a version number:",
        })
      ).version,
      10
    )) as number;
  if (isNaN(version) || version < 1) {
    return exit(1, chalk.red.bold(`Invalid version number: ${version}`));
  }

  const changesets = getChangesets(state, changesetParams);
  if (changesets.length === 0) {
    return exit(
      1,
      `There are no versions for ${chalk.bold(
        appOrBlock.name
      )} ${envDescription}`
    );
  }

  if (argv["commit-number"]) {
    console.log(
      chalk.green.bold(
        `Attempting to stage revert for commit #${argv["commit-number"]}...`
      )
    );
  } else {
    console.log(
      chalk.green.bold(`Attempting to stage revert for v${version}...`)
    );
  }

  const res = await dispatch({
    type: Client.ActionType.REVERT_ENVIRONMENT,
    payload: {
      ...changesetParams,
      version,
    },
  });
  await logAndExitIfActionFailed(res, "Staging the revert failed!");

  state = res.state;

  const [summary, pending, diffsByEnvironmentId] = getPending(state);
  console.log(summary);
  console.log("");
  console.log(pending);
  console.log(
    `Use ${chalk.bold("envkey commit")} to finalize the revert, or ${chalk.bold(
      "envkey reset"
    )} to undo.`
  );

  autoModeOut({
    version,
    changeset: changesetParams,
    pending: Object.keys(diffsByEnvironmentId).length
      ? diffsByEnvironmentId
      : null,
  });

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

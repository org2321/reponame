import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { authz } from "@core/lib/graph";
import {
  getChangesetCommitNumber,
  getChangesetForVersion,
  getChangesets,
  getEnvWithMetaForVersion,
  getLatestVersionNumber,
  getDiffsByKey,
  getEnvWithMetaCellDisplay,
} from "@core/lib/client";
import { Client, Model } from "@core/types";
import chalk from "chalk";
import {
  displayFullEnvName,
  printChangesetSummary,
  selectPrereqsForVersionCommands,
} from "../../lib/args";
import Table from "cli-table3";
import { fetchChangesetsIfNeeded, pushDiffRows } from "../../lib/envs";
import { autoModeOut, getPrompt } from "../../lib/console_io";

export const command = [
  "inspect [app-or-block] [environment] [version-number]",
  "show [app-or-block] [environment] [version-number]",
];
export const desc = "Compare versions for an environment.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("app-or-block", { type: "string", describe: "app name" })
    .positional("environment", {
      type: "string",
      describe: "environment name",
      conflicts: ["local-override", "override-user"],
    })
    .positional("version-number", {
      type: "number",
      describe: "version number to display",
    })
    .option("version-number", {
      type: "number",
      alias: ["ver", "n"],
      describe: "version number to display",
    })
    .option("all", {
      type: "boolean",
      describe:
        "Show all the variables in the version, rather than just the changes",
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
    .array("keys");
export const handler = async (
  argv: BaseArgs & {
    "app-or-block"?: string;
    environment?: string;
    "sub-environment"?: string;
    "local-override"?: boolean;
    "override-user"?: string;
    "version-number"?: number;
    all?: boolean;
    keys?: string[];
  }
): Promise<void> => {
  const prompt = getPrompt();
  let { state, auth } = await initCore(argv, true);
  let appOrBlock: Model.EnvParent;
  let shiftedPositional: number | undefined;
  let version: number = argv["version-number"] ?? -1;

  const result = await selectPrereqsForVersionCommands(
    state,
    auth,
    {
      ...argv,
      argvThirdPositional: version > -1 ? version : undefined,
    },
    authz.canReadEnv
  );

  ({ state, auth, shiftedPositional, appOrBlock } = result);

  if (!isNaN(shiftedPositional as number)) {
    version = shiftedPositional as number;
  }
  if (isNaN(version as number) || version < 1) {
    version = parseInt(
      (
        await prompt<{ version: string }>({
          type: "input",
          name: "version",
          required: true,
          message: "Enter a version number:",
        })
      ).version,
      10
    ) as number;
  }
  if (isNaN(version as number) || version < 1) {
    return exit(1, chalk.red.bold(`Invalid version number: ${version}`));
  }

  const envParentId = appOrBlock.id;
  const environmentId =
    "appEnv" in result ? result.appEnv.id : result.localOverrideEnvironmentId;
  const envDescription =
    "appEnv" in result
      ? `- ${chalk.bold(displayFullEnvName(state.graph, result.appEnv.id))}`
      : result.localOverrideEnvironmentId!.includes(auth.userId)
      ? "local overrides"
      : "user overrides";

  state = await fetchChangesetsIfNeeded(state, [envParentId]);

  const changesetParams = {
    envParentId,
    environmentId,
  } as Client.Env.ListVersionsParams;
  if (argv["keys"]) {
    changesetParams.entryKeys = argv["keys"] as string[];
  }
  const entryKeysSet = changesetParams.entryKeys
    ? new Set(changesetParams.entryKeys)
    : undefined;
  const changesets = getChangesets(state, changesetParams);
  if (changesets.length === 0) {
    return exit(
      1,
      `There are no versions for ${chalk.bold(
        appOrBlock.name
      )} ${envDescription}`
    );
  }

  const versionChangeset = getChangesetForVersion(state, {
    ...changesetParams,
    version,
  });
  if (!versionChangeset) {
    return exit(
      1,
      chalk.red.bold("Cannot find version with specified parameters!")
    );
  }

  const prevVersion = version - 1;
  const prevParams = {
    ...changesetParams,
    version: prevVersion,
  };
  const prevVersionEnv =
    prevVersion > 0 ? getEnvWithMetaForVersion(state, prevParams) : undefined;
  const prevChangeset = getChangesetForVersion(state, prevParams);
  const prevCommitNum = prevChangeset
    ? getChangesetCommitNumber(state, prevParams, prevChangeset)
    : undefined;

  const versionEnv = getEnvWithMetaForVersion(state, {
    ...changesetParams,
    version,
  });
  const versionCommitNum = getChangesetCommitNumber(
    state,
    changesetParams,
    versionChangeset
  );

  const currentVersion = getLatestVersionNumber(state, changesetParams);
  const currentParams = {
    ...changesetParams,
    version: currentVersion,
  };
  const currentVersionEnv =
    version !== currentVersion
      ? getEnvWithMetaForVersion(state, currentParams)
      : undefined;
  const currentChangeset = getChangesetForVersion(state, currentParams);
  const currentCommitNum = currentChangeset
    ? getChangesetCommitNumber(state, currentParams, currentChangeset)
    : undefined;

  console.log(
    `Viewing ${argv.all ? "environment at" : "changes in"} ${chalk.bold(
      "v" + version
    )}${version === currentVersion ? " (current)" : ""} for ${chalk.bold(
      appOrBlock.name
    )} ${envDescription}`,
    changesetParams.entryKeys
      ? `filtered by config keys: ${changesetParams.entryKeys.join(", ")}`
      : "",
    "\n"
  );
  console.log(printChangesetSummary(state, changesetParams, versionChangeset));

  const table = new Table();

  // Don't display diff, print all vars for the requested version
  if (argv.all) {
    if (!versionEnv) {
      return exit(1, "Cannot display version " + version);
    }
    // heading
    table.push([
      "",
      {
        content: chalk.bold.blueBright("v" + version),
        hAlign: "center",
      },
    ]);
    for (let k of Object.keys(versionEnv.variables)) {
      table.push([
        k,
        {
          content: getEnvWithMetaCellDisplay(
            state.graph,
            versionEnv.variables[k]
          ),
          hAlign: "center",
        },
      ]);
    }
    console.log(table.toString());
    autoModeOut(versionEnv);
    return exit();
  }

  if (prevVersionEnv) {
    table.push(
      [{ content: chalk.bold("Compared to previous version"), colSpan: 3 }],
      [
        "",
        chalk.bold(`commit #${prevCommitNum} v${prevVersion}`) + " (previous)",
        chalk.bold(`commit #${versionCommitNum} v${version}`),
      ]
    );
    const diff = getDiffsByKey(
      prevVersionEnv.variables,
      versionEnv.variables,
      entryKeysSet
    );
    if (Object.keys(diff).length === 0) {
      table.push([{ content: "No changes", colSpan: 3 }]);
    } else {
      pushDiffRows(state, table, diff);
    }
  }

  if (prevVersionEnv && currentVersionEnv) {
    const separator = [{ content: "", colSpan: 3 }];
    table.push(separator);
  }

  if (currentVersionEnv) {
    table.push(
      [{ content: chalk.bold("Compared to current version"), colSpan: 3 }],
      [
        "",
        chalk.bold(`commit #${versionCommitNum} v${version}`),
        chalk.bold(`commit #${currentCommitNum} v${currentVersion}`) +
          " (current)",
      ]
    );
    const diff = getDiffsByKey(
      versionEnv.variables,
      currentVersionEnv.variables,
      entryKeysSet
    );
    if (Object.keys(diff).length === 0) {
      table.push([{ content: "No changes", colSpan: 3 }]);
    } else {
      pushDiffRows(state, table, diff);
    }
  }

  console.log(table.toString());
  autoModeOut({
    prevVersion,
    prevVersionEnv,
    version,
    versionEnv,
    currentVersion,
    currentVersionEnv,
  });
  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

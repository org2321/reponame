import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { authz } from "@core/lib/graph";
import { getChangesets } from "@core/lib/client";
import { Client, Model } from "@core/types";
import chalk from "chalk";
import {
  displayFullEnvName,
  printChangesetSummary,
  selectPrereqsForVersionCommands,
} from "../../lib/args";
import Table from "cli-table3";
import { fetchChangesetsIfNeeded } from "../../lib/envs";
import { autoModeOut } from "../../lib/console_io";
import * as R from "ramda";

export const command = [
  "list [app-or-block] [environment]",
  "ls [app-or-block] [environment]",
];
export const desc = "Show change history for an environment";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("app-or-block", { type: "string", describe: "app name" })
    .positional("environment", {
      type: "string",
      describe: "environment name",
      conflicts: ["local-override", "override-user"],
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
    keys?: string[];
  }
): Promise<void> => {
  let { state, auth } = await initCore(argv, true);
  let appOrBlock: Model.EnvParent;

  const result = await selectPrereqsForVersionCommands(
    state,
    auth,
    argv,
    authz.canReadEnv
  );
  ({ state, auth, appOrBlock } = result);

  const envParentId = appOrBlock.id;
  const environmentId =
    "appEnv" in result ? result.appEnv.id : result.localOverrideEnvironmentId;
  const envDescription =
    "appEnv" in result
      ? `- ${chalk.bold(displayFullEnvName(state.graph, result.appEnv.id))}`
      : result.localOverrideEnvironmentId.includes(auth.userId)
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
  const changesets = getChangesets(state, changesetParams);
  if (changesets.length === 0) {
    console.log(
      `There are no versions for ${chalk.bold(
        appOrBlock.name
      )} ${envDescription}`
    );
    return exit(0);
  }

  const table = new Table({
    head: ["Changeset", "Version Num", "Change Type", "Keys Affected"],
    style: {
      head: [], //disable colors in header cells
    },
  });
  let actionVersionCounter = 0;
  changesets.forEach((c) => {
    c.actions.forEach((a, actionIndex) => {
      actionVersionCounter++;
      const changeTypeDisplayName = a.type.split("/")[
        a.type.split("/").length - 1
      ];

      const row = [
        `v${actionVersionCounter}`,
        changeTypeDisplayName,
        // TODO: not more than several
        a.meta.entryKeys.join(" "),
      ] as Table.HorizontalTableRow;

      // show changeset for first item and span for all changeset rows
      if (actionIndex === 0) {
        row.unshift({
          content: printChangesetSummary(state, changesetParams, c),
          rowSpan: c.actions.length,
        });
      }

      table.push(row);
    });
  });

  console.log(
    `Viewing versions for ${chalk.bold(appOrBlock.name)} ${envDescription}`,
    changesetParams.entryKeys
      ? `filtered by config keys: ${changesetParams.entryKeys.join(", ")}`
      : ""
  );
  console.log(
    table.toString(),
    "\nUse",
    chalk.bold(
      `envkey versions inspect [app-or-block] [environment] [version]`
    ),
    "to view specific changes.\n"
  );

  autoModeOut({
    versions: changesets.map((c, ix) => ({
      version: ix + 1,
      entryKeys: R.uniq(R.flatten(c.actions.map((a) => a.meta.entryKeys))),
      message: c.message,
    })),
  });
  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

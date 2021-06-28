import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { BaseArgs } from "../../types";
import * as R from "ramda";
import { getPending, selectPendingEnvironments } from "../../lib/envs";
import chalk from "chalk";
import { dispatch, initCore } from "../../lib/core";
import { Client, Model } from "@core/types";
import { logAndExitIfActionFailed } from "../../lib/args";
import { getEnvironmentName } from "@core/lib/graph";
import { autoModeOut, getPrompt } from "../../lib/console_io";

export const command = "reset [app-or-block] [environment]";
export const desc = "Reset pending environment changes.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("app-or-block", { type: "string", coerce: R.toLower })
    .positional("environment", { type: "string", coerce: R.toLower })
    .option("force", {
      type: "boolean",
      alias: "f",
      describe: "Auto-confirm",
    })
    .option("all", {
      type: "boolean",
      alias: "a",
      describe:
        "Reset all pending changes across apps, blocks, and environments",
      conflicts: ["app-or-block", "environment"],
    })
    .option("local-override", {
      type: "boolean",
      alias: ["l", "local-overrides"],
      describe: "Reset local overrides for the current user",
    })
    .option("override-for-user", {
      type: "string",
      alias: ["u", "overrides-for-user"],
      describe: "Reset local overrides for another user",
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
      describe: "Which variables to reset",
    })
    .array("keys");
export const handler = async (
  argv: BaseArgs & {
    "app-or-block"?: string;
    environment?: string;
    keys?: string[];
    "override-for-user"?: string;
    "local-override"?: boolean;
    force?: boolean;
    all?: boolean;
  }
): Promise<void> => {
  const prompt = getPrompt();
  let { state, auth } = await initCore(argv, true);

  const shouldResetAll = argv.all;
  let envParent: Model.EnvParent | undefined;
  let overrideUser: Model.OrgUser | Model.CliUser | undefined;
  let environment: Model.Environment | undefined;
  let pendingOpts: Parameters<typeof getPending>[1] | undefined;
  let pendingEnvironmentIds: string[] | undefined;

  if (shouldResetAll && argv.keys) {
    pendingOpts = { entryKeys: new Set(argv.keys) };
  } else {
    ({
      state,
      auth,
      envParent,
      user: overrideUser,
      environment,
      pendingOpts,
      pendingEnvironmentIds,
    } = await selectPendingEnvironments({
      state,
      auth,
      argv,
      appOrBlockArg: argv["app-or-block"],
      environmentArg: argv["environment"],
      overrideByUser:
        (argv["local-override"] && auth.userId) || argv["override-for-user"],
      entryKeys: argv.keys,
    }));
  }

  const [summary, pending] = getPending(state, pendingOpts);

  if (!pending) {
    console.log(
      chalk.bold(
        "There are no pending changes for these options. No work was done."
      )
    );
    return exit();
  }

  console.log(summary, "\n" + pending);

  if (!argv.force) {
    const { confirm } = await prompt<{ confirm: boolean }>({
      type: "confirm",
      name: "confirm",
      message: chalk.bold(
        `Reset ${
          argv.all
            ? "all pending"
            : [
                envParent!.name,
                getEnvironmentName(state.graph, environment!.id),
              ].join(" ")
        } changes${
          pendingOpts?.entryKeys && pendingOpts.entryKeys.size > 0
            ? " to " +
              Array.from(pendingOpts.entryKeys)
                .map((k) => `'${k}'`)
                .join(", ")
            : ""
        }?`
      ),
    });

    if (!confirm) {
      console.log(chalk.bold("Reset aborted!"));
      return exit();
    }
  }

  const entryKeys = argv.keys && argv.keys.length > 0 ? argv.keys : undefined;
  const res = await dispatch({
    type: Client.ActionType.RESET_ENVS,
    payload: {
      pendingEnvironmentIds:
        overrideUser && envParent
          ? [[envParent.id, overrideUser.id].join("|")]
          : pendingEnvironmentIds,
      entryKeys,
    },
  });
  await logAndExitIfActionFailed(
    res,
    "Failed to reset pending environment changes."
  );
  state = res.state;

  console.log("Pending changes were reset successfully.");

  const [postSummary, postPending, diffsByEnvironmentId] = getPending(state, {
    afterReset: true,
  });

  autoModeOut({
    entryKeys,
    pending: Object.keys(diffsByEnvironmentId).length
      ? diffsByEnvironmentId
      : null,
  });

  if (postPending) {
    console.log(postSummary, "\n", postPending);
    return exit();
  }

  console.log(chalk.bold("No more changes are pending."));

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

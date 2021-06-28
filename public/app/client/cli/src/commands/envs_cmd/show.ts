import * as R from "ramda";
import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { BaseArgs } from "../../types";
import {
  graphTypes,
  getEnvironmentsByEnvParentId,
  getEnvironmentName,
  authz,
  getSubEnvironmentsByParentEnvironmentId,
} from "@core/lib/graph";
import { initCore } from "../../lib/core";
import { getShowEnvs, fetchEnvsIfNeeded, getPending } from "../../lib/envs";
import { Model } from "@core/types";
import chalk from "chalk";
import { findCliUser, findUser } from "../../lib/args";
import { autoModeOut, getPrompt } from "../../lib/console_io";
import {
  firstArgIsEnvironment,
  tryApplyEnvkeyOverride,
} from "../../envkey_detection";

export const command = "show [app-or-block] [environments...]";
export const desc = "Show variables in plain text.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("app-or-block", { type: "string" })
    .positional("environments", { type: "string" })
    .array("environments")
    .option("sub-environments", {
      type: "string",
      alias: "s",
    })
    .array("sub-environments")
    .option("keys", {
      type: "string",
      alias: "k",
      describe: "Which variables to show",
    })
    .array("keys")
    .option("local-override", {
      type: "boolean",
      alias: ["l", "local-overrides"],
      describe: "Show local overrides for the current user",
    })
    .option("override-for-user", {
      type: "string",
      alias: ["u", "overrides-for-user"],
      describe: "Show local overrides for another user",
      conflicts: ["local-override"],
      coerce: (value) => {
        if (!value) {
          throw new Error("Missing user override");
        }
        return value;
      },
    });
export const handler = async (
  argv: BaseArgs & {
    "app-or-block"?: string;
    environments?: string[];
    "sub-environments"?: string[];
    keys?: string[];
    "local-override"?: boolean;
    "override-for-user"?: string;
  }
): Promise<void> => {
  const prompt = await getPrompt();
  let { state, auth } = await initCore(argv, true);

  let envParent: Model.EnvParent | undefined,
    environments: Model.Environment[],
    localOverrideForUserId: string | undefined;

  const { apps, blocks } = graphTypes(state.graph),
    envParents = [...apps, ...blocks],
    envParentsByName = R.indexBy(R.pipe(R.prop("name"), R.toLower), envParents),
    envParentsById = R.indexBy(R.pipe(R.prop("id"), R.toLower), envParents);

  if (argv["app-or-block"]) {
    envParent =
      envParentsByName[argv["app-or-block"].toLowerCase()] ??
      envParentsById[argv["app-or-block"].toLowerCase()];
  }
  if (!envParent) {
    if (tryApplyEnvkeyOverride(auth.userId, argv)) {
      return handler(argv);
    }
    const appId = argv["detectedEnvkey"]?.appId?.toLowerCase();
    if (appId) {
      const otherArgsValid =
        !argv["app-or-block"] ||
        firstArgIsEnvironment(state.graph, appId, argv["app-or-block"]);
      if (otherArgsValid) {
        envParent = envParentsByName[appId] ?? envParentsById[appId];
        if (envParent) {
          console.log("Detected app", chalk.bold(envParent.name), "\n");
        }
      }
    }
  }

  if (!envParent) {
    // determine if there's a default app
    // if app not found via arg or default, prompt for it

    const { name } = await prompt<{ name: string }>({
      type: "autocomplete",
      name: "name",
      message:
        "Choose an " +
        chalk.bold("app") +
        " or " +
        chalk.bold("block") +
        " (type to search):",
      initial: 0,
      choices: envParents.map((envParent) => ({
        name: envParent.name,
        message: chalk.bold(envParent.name),
      })),
    });

    envParent = envParentsByName[name];
  }

  environments = getEnvironmentsByEnvParentId(state.graph)[envParent.id] ?? [];

  if (argv["environments"]?.length) {
    const names = new Set(argv["environments"].map(R.toLower));
    environments = environments.filter(({ id }) =>
      names.has(getEnvironmentName(state.graph, id).toLowerCase())
    );
  }

  if (argv["sub-environments"]) {
    const baseEnvironments = environments.filter(R.complement(R.prop("isSub"))),
      names = new Set(argv["sub-environments"].map(R.toLower));

    let allSubEnvironments: Model.Environment[] = [];
    for (let parentEnvironment of baseEnvironments) {
      const subEnvironments =
        getSubEnvironmentsByParentEnvironmentId(state.graph)[
          parentEnvironment.id
        ] ?? [];

      if (names.size > 0) {
        allSubEnvironments = allSubEnvironments.concat(
          subEnvironments.filter(({ id }) =>
            names.has(getEnvironmentName(state.graph, id).toLowerCase())
          )
        );
      } else {
        allSubEnvironments = allSubEnvironments.concat(subEnvironments);
      }
    }

    environments = allSubEnvironments;
  }

  let showEnvironmentsIds = environments.map(R.prop("id"));

  if (argv["local-override"]) {
    localOverrideForUserId = auth.userId;
  } else if (argv["override-for-user"]) {
    const otherUser =
      findUser(state.graph, argv["override-for-user"]) ||
      findCliUser(state.graph, argv["override-for-user"]);
    if (!otherUser) {
      return exit(1, chalk.red.bold("User not found for override!"));
    }
    localOverrideForUserId = otherUser.id;
    if (
      !authz.canReadLocals(
        state.graph,
        auth.userId,
        envParent.id,
        localOverrideForUserId!
      )
    ) {
      return exit(
        1,
        chalk.red.bold(
          "You do not have permission to read the environment for that user."
        )
      );
    }
  }
  if (localOverrideForUserId) {
    console.log(chalk.bold("Fetching user overrides..."));
    showEnvironmentsIds = [[envParent.id, localOverrideForUserId].join("|")];
  }

  const entryKeys = argv["keys"]?.length ? new Set(argv["keys"]) : undefined;

  state = await fetchEnvsIfNeeded(state, [envParent.id]);

  const [output, envInfo] = getShowEnvs(
    state,
    envParent.id,
    showEnvironmentsIds,
    entryKeys
  );
  console.log(output, "\n");

  const environmentIds = new Set(environments.map(R.prop("id"))),
    filteredPending = state.pendingEnvUpdates.filter(
      ({ meta }) =>
        envParent!.id == meta.envParentId &&
        environmentIds.has(meta.environmentId) &&
        (!entryKeys || R.all((k) => entryKeys?.has(k) ?? false, meta.entryKeys))
    );

  if (filteredPending.length > 0) {
    console.log(
      "You have",
      chalk.bold("updates pending"),
      "for some of these variables. Use",
      chalk.bold("envkey pending"),
      "for details.\n"
    );
  }

  const [, , diffsByEnvironmentId] = getPending(state);
  autoModeOut({
    envs: envInfo,
    pending: Object.keys(diffsByEnvironmentId).length
      ? diffsByEnvironmentId
      : null,
  });

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

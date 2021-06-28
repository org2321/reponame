import * as R from "ramda";
import { Client, Model, Rbac } from "@core/types";
import { parseMultiFormat } from "@core/lib/parse";
import {
  getEnvironmentName,
  getEnvironmentsByEnvParentId,
  getSubEnvironmentsByParentEnvironmentId,
  graphTypes,
} from "@core/lib/graph";
import chalk from "chalk";
import Table from "cli-table3";
import {
  envsNeedFetch,
  changesetsNeedFetch,
  getEnvWithMeta,
  getPendingUpdateDetails,
  getEnvWithMetaCellDisplay,
} from "@core/lib/client";
import { spinnerWithText, stopSpinner } from "./spinner";
import { dispatch, initCore } from "./core";
import { Graph } from "@core/types/client/graph";
import { findCliUser, findUser } from "./args";
import { exit } from "./process";
import { getPrompt } from "./console_io";
import {
  firstArgIsEnvironment,
  tryApplyEnvkeyOverride,
} from "../envkey_detection";
import { BaseArgs } from "../types";

export const findEnvironment = (
  graph: Graph.UserGraph,
  envParentId: string,
  environmentArg: string
): Model.Environment | undefined => {
  const environments = getEnvironmentsByEnvParentId(graph)[envParentId] ?? [];
  return environments.find((env) => {
    const envName = getEnvironmentName(graph, env.id) as string;
    const role = graph[env.environmentRoleId] as Rbac.EnvironmentRole;
    return (
      envName.toLowerCase() === environmentArg.toLowerCase() ||
      env.id === environmentArg ||
      role.id === environmentArg
    );
  });
};

export const getEnvironmentTree = (
    graph: Client.Graph.UserGraph,
    envParentId: string
  ) => {
    const baseEnvironments = (
      getEnvironmentsByEnvParentId(graph)[envParentId] ?? []
    ).filter(R.complement(R.prop("isSub")));

    return R.flatten(
      baseEnvironments.map((environment) => {
        const name = getEnvironmentName(graph, environment.id),
          subEnvironments =
            getSubEnvironmentsByParentEnvironmentId(graph)[environment.id] ??
            [];

        return [
          name,
          ...subEnvironments.map(
            (subEnv) => "├──" + (subEnv as { subName: string }).subName
          ),
        ];
      })
    ).join("\n");
  },
  parseKeyValuePairs = R.pipe(
    R.filter(Boolean) as (v: string[]) => string[],
    R.map(R.curry(parseMultiFormat)(R.__, ["env", "json"])) as (
      v: string[]
    ) => Client.Env.RawEnv[],
    R.mergeAll
  ),
  pushDiffRows = (
    state: Client.State,
    table: Table.Table,
    diffs: Client.Env.DiffsByKey
  ) => {
    const keys = R.sortBy(R.identity, Object.keys(diffs));

    for (let k of keys) {
      table.push([
        k,
        {
          content:
            "🚫 " +
            chalk.red(
              getEnvWithMetaCellDisplay(state.graph, diffs[k].fromValue)
            ),
          hAlign: "center",
        },
        {
          content:
            chalk.bold(chalk.green("→ ")) +
            chalk.green(
              getEnvWithMetaCellDisplay(state.graph, diffs[k].toValue)
            ),
          hAlign: "center",
        },
      ]);
    }
  },
  getPending = (
    state: Client.State,
    opts: {
      envParentIds?: Set<string>;
      environmentIds?: Set<string>;
      entryKeys?: Set<string>;
      afterReset?: boolean;
    } = {}
  ): [string, string, Record<string, Client.Env.DiffsByKey>] => {
    const {
      filteredUpdates,
      apps,
      appEnvironments,
      appPaths,
      blocks,
      blockPaths,
      blockEnvironments,
      diffsByEnvironmentId,
      pendingLocalIds,
    } = getPendingUpdateDetails(state, opts);

    if (filteredUpdates.length == 0) {
      return ["", "", {}];
    }

    let summary = opts.afterReset
      ? "Updates " + chalk.bold("still pending") + " for"
      : "Updates pending for";

    if (apps.size) {
      summary +=
        chalk.bold(` ${apps.size} app${apps.size > 1 ? "s" : ""}`) +
        ` (${appEnvironments.size} environment${
          appEnvironments.size > 1 ? "s" : ""
        }, ${appPaths.size} variable${appPaths.size > 1 ? "s" : ""})`;
      if (blocks.size) {
        summary += " and ";
      }
    }
    if (blocks.size) {
      summary +=
        chalk.bold(`${blocks.size} block${blocks.size > 1 ? "s" : ""}`) +
        ` (${blockEnvironments.size} environment${
          blockEnvironments.size > 1 ? "s" : ""
        }, ${blockPaths.size} variable${blockPaths.size > 1 ? "s" : ""})`;
    }

    summary += ":";

    const diffTables: Table.Table[] = [];

    for (let envParentId of [...Array.from(apps), ...Array.from(blocks)]) {
      const envParent = state.graph[envParentId] as Model.EnvParent,
        table = new Table({
          colWidths: [24, 32, 32],
        });

      table.push([
        {
          content: chalk.bold(envParent.name),
          colSpan: 3,
        },
      ]);

      const baseEnvironments = (
        getEnvironmentsByEnvParentId(state.graph)[envParentId] ?? []
      ).filter(R.complement(R.prop("isSub")));

      for (let environment of baseEnvironments) {
        const diffs = diffsByEnvironmentId[environment.id],
          name = getEnvironmentName(state.graph, environment.id).toLowerCase();
        if (diffs) {
          table.push([
            {
              content: chalk.bold(chalk.cyan(name)),
              colSpan: 3,
            },
          ]);

          pushDiffRows(state, table, diffs);
        }

        const subEnvironments =
          getSubEnvironmentsByParentEnvironmentId(state.graph)[
            environment.id
          ] ?? [];

        for (let subEnv of subEnvironments) {
          if (!subEnv.isSub) continue;
          const diffs = diffsByEnvironmentId[subEnv.id];
          if (diffs) {
            table.push([
              {
                content: chalk.bold(
                  chalk.cyan(name) +
                    " → " +
                    chalk.cyan(subEnv.subName.toLowerCase())
                ),
                colSpan: 3,
              },
            ]);

            pushDiffRows(state, table, diffs);
          }
        }
      }

      for (let envId of pendingLocalIds) {
        const diffs = diffsByEnvironmentId[envId];
        const name = getEnvironmentName(state.graph, envId);
        if (diffs) {
          table.push([
            {
              content: `${chalk.bold(chalk.cyan(name))}`,
              colSpan: 3,
            },
          ]);

          pushDiffRows(state, table, diffs);
        }
      }

      diffTables.push(table);
    }

    return [
      summary,
      diffTables.map((t) => t.toString()).join("\n\n"),
      diffsByEnvironmentId || {},
    ];
  },
  getShowEnvsTable = (
    state: Client.State,
    envParentId: string,
    environmentIds: string[],
    entryKeys?: Set<string>
  ): [string, Record<string, Client.Env.EnvWithMeta>] => {
    const table = new Table({
      colWidths:
        // Long keys/values will be truncated, unless passing a single environment.
        environmentIds.length === 1
          ? []
          : [30, ...R.repeat(34, environmentIds.length)],
    });
    const envParent = state.graph[envParentId] as Model.EnvParent;

    const titleRow: Table.HorizontalTableRow = [chalk.bold(envParent.name)];

    const envWithMetaByEnvironmentId: Record<
        string,
        Client.Env.EnvWithMeta
      > = {},
      allKeys = new Set<string>();

    for (let environmentId of environmentIds) {
      // TODO: better UX is warranted for `show` of sub-environments, but would require refactors lower
      let maybeParentName = "";
      let thisEnvName: string;
      const isOverrideEnv = environmentId.includes("|");
      if (isOverrideEnv) {
        const overridenUserId = environmentId.split("|")[1];
        const orgUser =
          findUser(state.graph, overridenUserId) ||
          findCliUser(state.graph, overridenUserId);
        thisEnvName = orgUser
          ? orgUser.type === "cliUser"
            ? orgUser.name
            : [orgUser.firstName, orgUser.lastName].join(" ")
          : overridenUserId;
      } else {
        // override envs aren't quite normal environments
        thisEnvName = getEnvironmentName(
          state.graph,
          environmentId
        ).toLowerCase();
        const thisEnv = findEnvironment(
          state.graph,
          envParentId,
          environmentId
        );
        maybeParentName = thisEnv?.isSub
          ? getEnvironmentName(
              state.graph,
              thisEnv.parentEnvironmentId
            ).toLowerCase() + " > "
          : "";
      }
      titleRow.push({
        content: maybeParentName + chalk.bold(chalk.cyan(thisEnvName)),
        hAlign: "center",
      });

      const envWithMeta = getEnvWithMeta(state, {
        envParentId,
        environmentId,
      });

      envWithMetaByEnvironmentId[environmentId] = envWithMeta;

      for (let k in envWithMeta.variables) {
        if (entryKeys && !entryKeys.has(k)) {
          continue;
        }

        allKeys.add(k);
      }
    }

    table.push(titleRow);

    for (let k of R.sortBy(R.identity, Array.from(allKeys))) {
      table.push([
        k,
        ...environmentIds.map((id) => ({
          content: getEnvWithMetaCellDisplay(
            state.graph,
            envWithMetaByEnvironmentId[id].variables[k]
          ),
          hAlign: "center",
        })),
      ] as Table.Cell[]);
    }
    if (!allKeys.size) {
      table.push([
        { colSpan: environmentIds.length + 1, content: "No config yet" },
      ]);
    }

    return [table.toString(), envWithMetaByEnvironmentId];
  },
  getShowEnvs = (
    state: Client.State,
    envParentId: string,
    environmentIds: string[],
    entryKeys?: Set<string>
  ): [string, Record<string, Client.Env.EnvWithMeta>] => {
    const outputs: string[] = [];
    let envs: Record<string, Client.Env.EnvWithMeta> = {};
    // 3 columns
    let batchEnvironmentIds: string[] = [];
    for (let i = 0; i < environmentIds.length; i += 3) {
      batchEnvironmentIds = environmentIds.slice(i, i + 3);
      const [o, e] = getShowEnvsTable(
        state,
        envParentId,
        batchEnvironmentIds,
        entryKeys
      );
      outputs.push(o);
      envs = { ...envs, ...e };
    }
    return [outputs.join("\n\n"), envs];
  },
  selectPendingEnvironments = async (params: {
    state: Client.State;
    auth: Client.ClientUserAuth | Client.ClientCliAuth;
    argv: BaseArgs;
    appOrBlockArg?: string;
    environmentArg?: string;
    overrideByUser?: string;
    entryKeys?: string[];
  }): Promise<{
    state: Client.State;
    auth: Client.ClientUserAuth | Client.ClientCliAuth;
    envParent: Model.EnvParent | undefined;
    user: Model.OrgUser | Model.CliUser | undefined;
    environment: Model.Environment | undefined;
    pendingOpts: Parameters<typeof getPending>[1] | object | undefined;
    pendingEnvironmentIds: string[] | undefined;
  }> => {
    const { argv, appOrBlockArg, overrideByUser, entryKeys } = params;
    let { state, auth, environmentArg } = params;
    const prompt = getPrompt();

    let envParent: Model.EnvParent | undefined;
    let environment: Model.Environment | undefined;
    let apps: Model.App[] = [];
    let blocks: Model.Block[] = [];
    let envParents: Model.EnvParent[] = [];
    let envParentsByName: Record<string, Model.EnvParent> = {};
    let envParentsById: Record<string, Model.EnvParent> = {};

    const setupSharedVars = () => {
      ({ apps, blocks } = graphTypes(state.graph));
      envParents = [...apps, ...blocks];
      envParentsByName = R.indexBy(
        R.pipe(R.prop("name"), R.toLower),
        envParents
      );
      envParentsById = R.indexBy(R.pipe(R.prop("id"), R.toLower), envParents);
    };

    setupSharedVars();

    if (appOrBlockArg) {
      envParent =
        envParentsByName[appOrBlockArg.toLowerCase()] ??
        envParentsById[appOrBlockArg.toLowerCase()];
    }

    // detection from ENVKEY
    if (!envParent) {
      if (tryApplyEnvkeyOverride(auth.userId, argv)) {
        ({ auth, state } = await initCore(argv, true));
        setupSharedVars();
        const appId = argv["detectedEnvkey"]?.appId?.toLowerCase();
        if (appId) {
          const envFirst = firstArgIsEnvironment(
            state.graph,
            appId,
            appOrBlockArg
          );
          const otherArgsValid = !appOrBlockArg || envFirst;
          if (otherArgsValid) {
            envParent = state.graph[appId] as Model.App | undefined;
            if (envParent) {
              console.log("Detected app", chalk.bold(envParent.name), "\n");
              if (envFirst && !environmentArg) {
                // shuffle right
                environmentArg = appOrBlockArg;
              }
            }
          }
        }
      }
    }

    if (!envParent) {
      // determine if there's a default app
      // if app/block not found via arg or default, prompt for it

      const { parentName } = await prompt<{
        parentName: string;
      }>({
        type: "autocomplete",
        name: "parentName",
        message:
          "Choose an " +
          chalk.bold("app") +
          " or " +
          chalk.bold("block") +
          " (type to search):",
        initial: 0,
        required: true,
        choices: R.sort(
          R.ascend(R.prop("message")),
          envParents.map((envParent) => ({
            name: envParent.name,
            message: chalk.bold(envParent.name),
          }))
        ),
      });

      envParent = envParentsByName[parentName];
    }
    if (!envParent) {
      return exit(1, chalk.red.bold("Invalid app-or-block!"));
    }
    if (overrideByUser) {
      const user =
        findUser(state.graph, overrideByUser) ||
        findCliUser(state.graph, overrideByUser);
      if (!user) {
        return exit(1, chalk.red.bold("User not found!"));
      }
      const userCompositeOverrideId = [envParent.id, user.id].join("|");
      return {
        auth,
        state,
        environment: undefined,
        pendingOpts: {
          envParentIds: new Set([envParent.id]),
          environmentIds: new Set([userCompositeOverrideId]),
        },
        pendingEnvironmentIds: [userCompositeOverrideId],
        envParent,
        user,
      };
    }

    const pendingEnvsChoices = (
      getEnvironmentsByEnvParentId(state.graph)[envParent.id] ?? []
    )
      .filter((ae) => {
        const [, pending] = getPending(state, {
          envParentIds: new Set([envParent!.id]),
          environmentIds: new Set([ae.id]),
        });
        return Boolean(pending);
      })
      .map((ae) => {
        return {
          name: ae.id,
          message: chalk.bold(
            (state.graph[ae.environmentRoleId] as Rbac.EnvironmentRole).name +
              (ae.isSub ? ` > ${ae.subName}` : "")
          ),
        };
      });
    if (!pendingEnvsChoices.length) {
      let message = chalk.red(
        `No environments for ${chalk.bold(
          envParent.name
        )} have pending updates. No work was done.`
      );
      const [, allPending] = getPending(state);
      if (allPending) {
        message += "Other environments do have pending updates:\n" + allPending;
      }
      return exit(1, message);
    }
    const environmentName = (environmentArg ??
      (
        await prompt<{ environment: string }>({
          type: "select",
          name: "environment",
          message: "Select environment:",
          initial: 0,
          required: true,
          choices: pendingEnvsChoices,
        })
      ).environment) as string;
    environment = findEnvironment(state.graph, envParent.id, environmentName);
    if (!environment) {
      return exit(
        1,
        chalk.red(
          `Environment ${chalk.bold(
            environmentName
          )} does not exist, or you do not have access.`
        )
      );
    }

    return {
      state,
      auth,
      user: undefined,
      pendingOpts: {
        envParentIds: new Set([envParent.id]),
        environmentIds: new Set([environment.id]),
        entryKeys:
          entryKeys && entryKeys.length > 0 ? new Set(entryKeys) : undefined,
      },
      pendingEnvironmentIds: [environment.id],
      envParent,
      environment,
    };
  },
  fetchEnvsIfNeeded = async (state: Client.State, envParentIds: string[]) => {
    let toFetchIds: string[] = [];
    for (let id of envParentIds) {
      if (envsNeedFetch(state, id)) {
        toFetchIds.push(id);
      }
    }

    if (toFetchIds.length > 0) {
      spinnerWithText("Fetching and decrypting...");
      const fetchRes = await dispatch({
        type: Client.ActionType.FETCH_ENVS,
        payload: {
          envParentIds: toFetchIds,
          envs: true,
        },
      });
      stopSpinner();
      return fetchRes.state;
    }

    return state;
  },
  fetchChangesetsIfNeeded = async (
    state: Client.State,
    envParentIds: string[]
  ): Promise<Client.State> => {
    let toFetchIds: string[] = [];
    for (let id of envParentIds) {
      if (changesetsNeedFetch(state, id)) {
        toFetchIds.push(id);
      }
    }

    if (toFetchIds.length > 0) {
      spinnerWithText("Fetching and decrypting...");
      const fetchRes = await dispatch({
        type: Client.ActionType.FETCH_ENVS,
        payload: {
          envParentIds: toFetchIds,
          changesets: true,
        },
      });
      stopSpinner();
      // TODO: handle errors
      return fetchRes.state;
    }

    return state;
  };

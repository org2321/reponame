import * as R from "ramda";
import { Client, Model } from "@core/types";
import { EnvsUiPermissions, OrgComponentProps } from "@ui_types";
import * as g from "@core/lib/graph";
import { envsNeedFetch } from "@core/lib/client";

export const getEnvsUiPermissions = (
    graph: Client.Graph.UserGraph,
    currentUserId: string,
    envParentId: string,
    environmentIds: string[],
    localsUserId?: string
  ): EnvsUiPermissions =>
    R.mergeAll(
      environmentIds
        .map((environmentId) => {
          const canRead = localsUserId
            ? g.authz.canReadLocals(
                graph,
                currentUserId,
                envParentId,
                localsUserId
              )
            : g.authz.canReadEnv(graph, currentUserId, environmentId);

          const canReadMeta = localsUserId
            ? false
            : g.authz.canReadEnvMeta(graph, currentUserId, environmentId);

          const canUpdate = localsUserId
            ? g.authz.canUpdateLocals(
                graph,
                currentUserId,
                envParentId,
                localsUserId
              )
            : g.authz.canUpdateEnv(graph, currentUserId, environmentId);

          return {
            [environmentId]: { canRead, canUpdate, canReadMeta },
          };
        })
        .filter((res): res is EnvsUiPermissions => typeof res != "undefined")
    ),
  getValDisplay = (val: string) =>
    val.split(/\n/).join("\\n").split(/\r/).join("\\r"),
  fetchEnvsIfNeeded = (
    props: OrgComponentProps,
    envParentIdOrIds: string | string[]
  ) => {
    let toFetchIds: string[] = [];
    let envParentIds: string[] = Array.isArray(envParentIdOrIds)
      ? envParentIdOrIds
      : [envParentIdOrIds];

    const envParents = envParentIds.map(
      (id) => props.core.graph[id] as Model.EnvParent
    );
    for (let envParent of envParents) {
      if (envParent.type == "app") {
        const connectedBlocks = g.getConnectedBlocksForApp(
          props.core.graph,
          envParent.id
        );
        envParentIds = envParentIds.concat(connectedBlocks.map(R.prop("id")));
      }
    }

    for (let id of envParentIds) {
      if (envsNeedFetch(props.core, id)) {
        toFetchIds.push(id);
      }
    }

    if (toFetchIds.length > 0) {
      return props.dispatch({
        type: Client.ActionType.FETCH_ENVS,
        payload: {
          envParentIds: toFetchIds,
          envs: true,
        },
      });
    }
  };

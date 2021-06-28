import { Graph, Model } from "../../../../types";
import { authorizeUser, hasAllAppPermissions, presence } from "./helpers";
import {
  getEnvironmentPermissions,
  getEnvironmentsByEnvParentId,
  getEnvParentPermissions,
} from "../../.";
import * as R from "ramda";
import memoize from "../../../utils/memoize";
import { getVisibleBaseEnvironmentAndLocalIds } from "..";

export const canUpdateEnv = (
    graph: Graph.Graph,
    currentUserId: string,
    environmentId: string
  ) =>
    getEnvironmentPermissions(graph, environmentId, currentUserId).has("write"),
  canReadEnv = (
    graph: Graph.Graph,
    currentUserId: string,
    environmentId: string
  ) =>
    getEnvironmentPermissions(graph, environmentId, currentUserId).has("read"),
  canReadEnvMeta = (
    graph: Graph.Graph,
    currentUserId: string,
    environmentId: string
  ) =>
    getEnvironmentPermissions(graph, environmentId, currentUserId).has(
      "read_meta"
    ),
  canUpdateSubEnvs = (
    graph: Graph.Graph,
    currentUserId: string,
    parentEnvironmentId: string
  ) =>
    getEnvironmentPermissions(graph, parentEnvironmentId, currentUserId).has(
      "write_subenvs"
    ),
  canReadSubEnvs = (
    graph: Graph.Graph,
    currentUserId: string,
    parentEnvironmentId: string
  ) =>
    getEnvironmentPermissions(graph, parentEnvironmentId, currentUserId).has(
      "read_subenvs"
    ),
  canReadSubEnvsMeta = (
    graph: Graph.Graph,
    currentUserId: string,
    parentEnvironmentId: string
  ) =>
    getEnvironmentPermissions(graph, parentEnvironmentId, currentUserId).has(
      "read_subenvs_meta"
    ),
  canReadEnvInherits = (
    graph: Graph.Graph,
    currentUserId: string,
    environmentId: string
  ) =>
    getEnvironmentPermissions(graph, environmentId, currentUserId).has(
      "read_inherits"
    ),
  canReadVersions = (
    graph: Graph.Graph,
    currentUserId: string,
    environmentId: string
  ) =>
    getEnvironmentPermissions(graph, environmentId, currentUserId).has(
      "read_history"
    ),
  canCreateBaseEnvironment = (
    graph: Graph.Graph,
    currentUserId: string,
    envParentId: string,
    environmentRoleId: string
  ) => {
    if (!canCreateOrDeleteBaseEnvironments(graph, currentUserId, envParentId)) {
      return false;
    }

    const environments = getEnvironmentsByEnvParentId(graph)[envParentId] ?? [];
    if (
      environments.find(
        (environment) => environment.environmentRoleId == environmentRoleId
      )
    ) {
      return false;
    }

    return true;
  },
  canCreateSubEnvironment = (
    graph: Graph.Graph,
    currentUserId: string,
    parentEnvironmentId: string
  ) => {
    const parentEnvironment = presence(
      graph[parentEnvironmentId] as Model.Environment,
      "environment"
    );
    if (!parentEnvironment) {
      return false;
    }

    if (parentEnvironment.isSub) {
      return false;
    }

    return getEnvironmentPermissions(
      graph,
      parentEnvironmentId,
      currentUserId
    ).has("write_subenvs");
  },
  canDeleteEnvironment = (
    graph: Graph.Graph,
    currentUserId: string,
    environmentId: string
  ) => {
    const environment = presence(
      graph[environmentId] as Model.Environment,
      "environment"
    );
    if (!environment) {
      return false;
    }

    if (environment.isSub) {
      return getEnvironmentPermissions(
        graph,
        environment.parentEnvironmentId,
        currentUserId
      ).has("write_subenvs");
    } else {
      return canCreateOrDeleteBaseEnvironments(
        graph,
        currentUserId,
        environment.envParentId
      );
    }
  },
  canUpdateLocals = (
    graph: Graph.Graph,
    currentUserId: string,
    envParentId: string,
    localsUserId: string
  ) => {
    const currentUserRes = authorizeUser(graph, currentUserId);
    if (!currentUserRes) {
      return false;
    }
    const [, , currentOrgPermissions] = currentUserRes;

    const envParent =
      presence(graph[envParentId] as Model.App, "app") ||
      presence(graph[envParentId] as Model.Block, "block");

    if (!envParent) {
      return false;
    }

    if (currentUserId == localsUserId) {
      return true;
    }

    const currentUserCanWriteOrgBlock =
      envParent.type == "block" &&
      currentOrgPermissions.has("blocks_write_envs_all");

    const envParentPermissions = getEnvParentPermissions(
      graph,
      envParentId,
      currentUserId
    );

    return (
      currentUserCanWriteOrgBlock ||
      envParentPermissions.has("app_write_user_locals")
    );
  },
  canReadLocals = (
    graph: Graph.Graph,
    currentUserId: string,
    envParentId: string,
    localsUserId: string
  ) => {
    const currentUserRes = authorizeUser(graph, currentUserId);
    if (!currentUserRes) {
      return false;
    }
    const [, , currentOrgPermissions] = currentUserRes;

    const envParent =
      presence(graph[envParentId] as Model.App, "app") ||
      presence(graph[envParentId] as Model.Block, "block");

    if (!envParent) {
      return false;
    }

    if (currentUserId == localsUserId) {
      return true;
    }

    const currentUserCanReadOrgBlock =
      envParent.type == "block" && currentOrgPermissions.has("blocks_read_all");

    const envParentPermissions = getEnvParentPermissions(
      graph,
      envParentId,
      currentUserId
    );

    return (
      currentUserCanReadOrgBlock ||
      envParentPermissions.has("app_read_user_locals")
    );
  },
  canReadLocalsVersions = (
    graph: Graph.Graph,
    currentUserId: string,
    envParentId: string,
    localsUserId: string
  ) => {
    const currentUserRes = authorizeUser(graph, currentUserId);
    if (!currentUserRes) {
      return false;
    }
    const [, , currentOrgPermissions] = currentUserRes;

    const envParent =
      presence(graph[envParentId] as Model.App, "app") ||
      presence(graph[envParentId] as Model.Block, "block");

    if (!envParent) {
      return false;
    }

    if (currentUserId == localsUserId) {
      return true;
    }

    const currentUserCanReadOrgBlock =
      envParent.type == "block" && currentOrgPermissions.has("blocks_read_all");

    const envParentPermissions = getEnvParentPermissions(
      graph,
      envParentId,
      currentUserId
    );

    return (
      currentUserCanReadOrgBlock ||
      envParentPermissions.has("app_read_user_locals_history")
    );
  },
  canReadAnyEnvParentVersions = memoize(
    (graph: Graph.Graph, currentUserId: string, envParentId: string) =>
      R.any(
        Boolean,
        getVisibleBaseEnvironmentAndLocalIds(
          graph,
          currentUserId,
          envParentId
        ).map((environmentOrLocalId) => {
          const split = environmentOrLocalId.split("|");
          if (split.length == 2) {
            const [, localsUserId] = split;
            return canReadLocalsVersions(
              graph,
              currentUserId,
              envParentId,
              localsUserId
            );
          } else {
            return canReadVersions(graph, currentUserId, environmentOrLocalId);
          }
        })
      )
  );

const canCreateOrDeleteBaseEnvironments = (
  graph: Graph.Graph,
  currentUserId: string,
  envParentId: string
) => {
  const currentUserRes = authorizeUser(graph, currentUserId);
  if (!currentUserRes) {
    return false;
  }
  const [, , currentOrgPermissions] = currentUserRes;

  const envParent =
    presence(graph[envParentId] as Model.App, "app") ||
    presence(graph[envParentId] as Model.Block, "block");

  if (!envParent) {
    return false;
  }

  if (envParent.type == "block") {
    return currentOrgPermissions.has("blocks_manage_environments");
  }

  return hasAllAppPermissions(graph, currentUserId, envParentId, [
    "app_manage_environments",
  ]);
};

import produce from "immer";
import { v4 as uuid } from "uuid";
import { apiAction } from "../handler";
import { Api, Blob, Model, Auth, Client, Rbac } from "@core/types";
import * as R from "ramda";
import { getFetchActionLogTargetIdsFn } from "../models/logs";
import {
  getEnvironmentsByEnvParentId,
  getEnvironmentPermissions,
  getConnectedBlocksForApp,
  getConnectedActiveGeneratedEnvkeys,
  deleteGraphObjects,
  authz,
  getDeleteEnvironmentProducer,
  getConnectedBlockEnvironmentsForApp,
  environmentCompositeId,
} from "@core/lib/graph";
import { pick } from "@core/lib/utils/pick";
import { graphKey } from "../db";
import {
  getGeneratedEnvkeyEncryptedKey,
  getUserEncryptedKey,
  getEncryptedBlobKey,
} from "../blob";
import { log } from "@core/lib/utils/logger";
import { setEnvsUpdatedFields } from "../graph";

apiAction<
  Api.Action.RequestActions["UpdateEnvs"],
  Api.Net.ApiResultTypes["UpdateEnvs"]
>({
  type: Api.ActionType.UPDATE_ENVS,
  graphAction: true,
  authenticated: true,
  // no graphAuthorizer needed here since blob updates are authorized at the handler level
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const { updatedGraph, updatingEnvironmentIds } = setEnvsUpdatedFields(
      auth,
      orgGraph,
      payload.blobs,
      now
    );

    const userEncryptedKeys = payload.keys.users ?? {};
    const deleteInheritanceOverrideKeys = new Set<Api.Db.DbKey>();

    // for any base environment we're updating, clear out any inheritance overrides
    // set for it on sibling environments that are not included in the update
    for (let environmentId of updatingEnvironmentIds) {
      const environment = orgGraph[environmentId] as Model.Environment;
      if (environment.isSub) {
        continue;
      }

      const envParent = orgGraph[environment.envParentId] as Model.EnvParent,
        envParentEnvironments =
          getEnvironmentsByEnvParentId(orgGraph)[environment.envParentId] ?? [];

      for (let envParentEnvironment of envParentEnvironments) {
        if (envParentEnvironment.id == environment.id) {
          continue;
        }

        if (
          R.path(
            [
              envParent.id,
              "environments",
              envParentEnvironment.id,
              "inheritanceOverrides",
              environment.id,
            ],
            payload.blobs
          )
        ) {
          continue;
        }

        // inheritance overrides encrypted blobs
        deleteInheritanceOverrideKeys.add(
          getEncryptedBlobKey({
            orgId: auth.org.id,
            envParentId: envParent.id,
            environmentId: envParentEnvironment.id,
            inheritsEnvironmentId: environment.id,
            blobType: "env",
            envType: "inheritanceOverrides",
            envPart: "env",
          })
        );

        // user inheritance overrides encrypted keys
        for (let userId in userEncryptedKeys) {
          for (let deviceId in userEncryptedKeys[userId]) {
            deleteInheritanceOverrideKeys.add(
              getUserEncryptedKey({
                orgId: auth.org.id,
                userId,
                deviceId,
                envParentId: envParent.id,
                environmentId: envParentEnvironment.id,
                inheritsEnvironmentId: environment.id,
                blobType: "env",
                envType: "inheritanceOverrides",
                envPart: "env",
              })
            );
          }
        }

        // keyable inheritance overrides encrypted keys
        const generatedEnvkeys = getConnectedActiveGeneratedEnvkeys(
          orgGraph,
          envParentEnvironment.id
        ) as Api.Db.GeneratedEnvkey[];

        for (let generatedEnvkey of generatedEnvkeys) {
          if (generatedEnvkey) {
            deleteInheritanceOverrideKeys.add(
              getGeneratedEnvkeyEncryptedKey(
                generatedEnvkey.envkeyIdPart,
                "inheritanceOverrides",
                envParent.type == "block" ? envParent.id : undefined,
                environmentId
              )
            );
          }
        }
      }
    }

    const logTargetIds = new Set<string>();
    for (let envParentId in payload.blobs) {
      logTargetIds.add(envParentId);
      const { environments, locals } = payload.blobs[envParentId];
      for (let environmentId in environments) {
        const environment = orgGraph[environmentId] as Model.Environment;

        logTargetIds.add(environment.environmentRoleId);

        if (environment.isSub) {
          logTargetIds.add(environmentCompositeId(environment));
        }
      }
      for (let localsUserId in locals) {
        logTargetIds.add("locals");
        logTargetIds.add(localsUserId);
      }
    }

    log("logTargetIds", Array.from(logTargetIds));

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      transactionItems: {
        hardDeleteKeys: Array.from(deleteInheritanceOverrideKeys),
      },
      logTargetIds: Array.from(logTargetIds),
    };
  },
});

apiAction<
  Api.Action.RequestActions["FetchEnvs"],
  Api.Net.ApiResultTypes["FetchEnvs"]
>({
  type: Api.ActionType.FETCH_ENVS,
  graphAction: true,
  skipGraphUpdatedAtCheck: true,
  authenticated: true,
  graphResponse: "graphWithEnvs",
  graphAuthorizer: async (action, orgGraph, userGraph, auth) => {
    for (let envParentId of action.payload.envParentIds) {
      if (!userGraph[envParentId]) {
        return false;
      }
    }

    return true;
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    let envs: Api.HandlerEnvsResponse | undefined,
      inheritanceOverrides: Api.HandlerEnvsResponse | undefined,
      changesets: Api.HandlerChangesetsResponse | undefined;

    if (payload.envs) {
      envs = getHandlerEnvsResponse(orgGraph, payload.envParentIds, "env");
      inheritanceOverrides = getHandlerEnvsResponse(
        orgGraph,
        payload.envParentIds,
        "inheritanceOverrides"
      );
    }

    if (payload.changesets) {
      changesets = getHandlerEnvsResponse(
        orgGraph,
        payload.envParentIds,
        "changeset"
      );

      if (payload.changesetOptions?.createdAfter) {
        changesets.createdAfter = payload.changesetOptions?.createdAfter;
      }
    }

    return {
      type: "graphHandlerResult",
      graph: orgGraph,
      recentChangesets: payload.changesetOptions?.createdAfter
        ? true
        : undefined,
      envs,
      changesets,
      inheritanceOverrides,
      logTargetIds: getFetchActionLogTargetIdsFn(orgGraph),
    };
  },
});

apiAction<
  Api.Action.RequestActions["CreateVariableGroup"],
  Api.Net.ApiResultTypes["CreateVariableGroup"]
>({
  type: Api.ActionType.CREATE_VARIABLE_GROUP,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (
    { payload: { envParentId, subEnvironmentId } },
    orgGraph,
    userGraph,
    auth
  ) =>
    canCreateOrDeleteVariableGroup(
      userGraph,
      auth,
      envParentId,
      subEnvironmentId
    ),
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const id = uuid(),
      variableGroup: Api.Db.VariableGroup = {
        type: "variableGroup",
        id,
        ...graphKey(auth.org.id, "variableGroup", id),
        ...pick(["envParentId", "subEnvironmentId", "name"], payload),
        createdAt: now,
        updatedAt: now,
      };

    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [variableGroup.id]: variableGroup,
      },
      logTargetIds: [],
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteVariableGroup"],
  Api.Net.ApiResultTypes["DeleteVariableGroup"]
>({
  type: Api.ActionType.DELETE_VARIABLE_GROUP,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload: { id } }, orgGraph, userGraph, auth) => {
    const variableGroup = userGraph[id];
    if (!variableGroup || variableGroup.type != "variableGroup") {
      return false;
    }

    return canCreateOrDeleteVariableGroup(
      userGraph,
      auth,
      variableGroup.envParentId,
      variableGroup.subEnvironmentId
    );
  },
  graphHandler: async (action, orgGraph, auth, now) => {
    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(orgGraph, [action.payload.id], now),
      logTargetIds: [],
    };
  },
});

apiAction<
  Api.Action.RequestActions["CreateEnvironment"],
  Api.Net.ApiResultTypes["CreateEnvironment"]
>({
  type: Api.ActionType.CREATE_ENVIRONMENT,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) =>
    payload.isSub
      ? authz.canCreateSubEnvironment(
          userGraph,
          auth.user.id,
          payload.parentEnvironmentId
        )
      : authz.canCreateBaseEnvironment(
          userGraph,
          auth.user.id,
          payload.envParentId,
          payload.environmentRoleId
        ),
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const id = uuid(),
      environment: Api.Db.Environment = {
        ...graphKey(auth.org.id, "environment", id),
        ...(pick(
          [
            "envParentId",
            "environmentRoleId",
            "isSub",
            "parentEnvironmentId",
            "subName",
          ],
          payload
        ) as Model.Environment),
        type: "environment",
        id,
        createdAt: now,
        updatedAt: now,
      },
      envParent = orgGraph[environment.envParentId] as Model.EnvParent,
      updatedGraph = produce(orgGraph, (draft) => {
        draft[environment.id] = environment;
      });

    const scopeEnvironments = [
      environment,
      ...(envParent.type == "app"
        ? getConnectedBlockEnvironmentsForApp(
            updatedGraph,
            envParent.id,
            undefined,
            environment.id
          )
        : []),
    ];

    const scope: Rbac.OrgAccessScope = {
      userIds: "all",
      envParentIds: new Set(scopeEnvironments.map(R.prop("envParentId"))),
      environmentIds: new Set(scopeEnvironments.map(R.prop("id"))),
    };

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [
        envParent.id,
        environment.environmentRoleId,
        environment.isSub ? environmentCompositeId(environment) : undefined,
      ].filter((id): id is string => Boolean(id)),
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteEnvironment"],
  Api.Net.ApiResultTypes["DeleteEnvironment"]
>({
  type: Api.ActionType.DELETE_ENVIRONMENT,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload: { id } }, orgGraph, userGraph, auth) =>
    authz.canDeleteEnvironment(userGraph, auth.user.id, id),
  graphHandler: async (action, orgGraph, auth, now) => {
    const environment = orgGraph[action.payload.id] as Model.Environment;
    const envParent = orgGraph[environment.envParentId] as Model.EnvParent;

    const updatedGraph = produce(
      orgGraph,
      getDeleteEnvironmentProducer(action.payload.id, now)
    ) as Api.Graph.OrgGraph;

    const scopeEnvironments = [
      environment,
      ...(envParent.type == "app"
        ? getConnectedBlockEnvironmentsForApp(
            orgGraph,
            envParent.id,
            undefined,
            environment.id
          )
        : []),
    ];

    const scope: Rbac.OrgAccessScope = {
      userIds: "all",
      envParentIds: new Set(scopeEnvironments.map(R.prop("envParentId"))),
      environmentIds: new Set(scopeEnvironments.map(R.prop("id"))),
    };

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      transactionItems: {
        hardDeleteEncryptedBlobParams: [
          {
            orgId: auth.org.id,
            envParentId: environment.envParentId,
            environmentId: environment.id,
            blobType: "env",
          },
          {
            orgId: auth.org.id,
            envParentId: environment.envParentId,
            environmentId: environment.id,
            blobType: "changeset",
          },
        ],
      },
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [
        envParent.id,
        environment.environmentRoleId,
        environment.isSub ? environmentCompositeId(environment) : undefined,
      ].filter((id): id is string => Boolean(id)),
    };
  },
});

apiAction<
  Api.Action.RequestActions["UpdateEnvironmentSettings"],
  Api.Net.ApiResultTypes["UpdateEnvironmentSettings"]
>({
  type: Api.ActionType.UPDATE_ENVIRONMENT_SETTINGS,
  authenticated: true,
  graphAction: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const environment = userGraph[payload.id];
    if (
      !environment ||
      environment.type != "environment" ||
      environment.isSub
    ) {
      return false;
    }
    const envParent = orgGraph[environment.envParentId] as Model.EnvParent;

    return envParent.type == "app"
      ? authz.hasAppPermission(
          orgGraph,
          auth.user.id,
          environment.envParentId,
          "app_manage_environments"
        )
      : authz.hasOrgPermission(
          orgGraph,
          auth.user.id,
          "blocks_manage_environments"
        );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const environment = orgGraph[payload.id] as Api.Db.Environment;
    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [payload.id]: {
          ...environment,
          settings: payload.settings,
        },
      },
      logTargetIds: [
        environment.envParentId,
        environment.environmentRoleId,
        environment.isSub ? environmentCompositeId(environment) : undefined,
      ].filter((id): id is string => Boolean(id)),
    };
  },
});

const canCreateOrDeleteVariableGroup = (
    userGraph: Client.Graph.UserGraph,
    auth: Auth.DefaultAuthContext,
    envParentId: string,
    subEnvironmentId?: string
  ) => {
    const envParent = userGraph[envParentId];
    if (!envParent) {
      return false;
    }

    if (subEnvironmentId) {
      const subEnvironment = userGraph[subEnvironmentId];
      if (!subEnvironment) {
        return false;
      }

      const permissions = getEnvironmentPermissions(
        userGraph,
        subEnvironmentId,
        auth.user.id
      );
      return permissions.has("write");
    }

    const environments =
      getEnvironmentsByEnvParentId(userGraph)[envParentId] || [];
    if (environments.length == 0) {
      return false;
    }

    for (let environment of environments) {
      const permissions = getEnvironmentPermissions(
        userGraph,
        environment.id,
        auth.user.id
      );
      if (!permissions.has("write")) {
        return false;
      }
    }

    return true;
  },
  getHandlerEnvsResponse = <
    BlobType extends "env" | "inheritanceOverrides" | "changeset"
  >(
    orgGraph: Api.Graph.OrgGraph,
    envParentIds: string[],
    blobType: BlobType
  ) => {
    return {
      scopes: R.flatten(
        envParentIds.map((envParentId) => {
          const envParent = orgGraph[envParentId] as Model.EnvParent;
          let connectedScopes: Blob.ScopeParams[];
          if (envParent.type == "app") {
            const blockIds = getConnectedBlocksForApp(
              orgGraph,
              envParentId
            ).map(R.prop("id"));
            connectedScopes = blockIds.map(
              (blockId) =>
                ({
                  blobType,
                  envParentId: blockId,
                } as Blob.ScopeParams)
            );
          } else {
            connectedScopes = [];
          }

          return [{ blobType, envParentId }, ...connectedScopes];
        })
      ),
    } as BlobType extends "changeset"
      ? Api.HandlerChangesetsResponse
      : Api.HandlerEnvsResponse;
  };

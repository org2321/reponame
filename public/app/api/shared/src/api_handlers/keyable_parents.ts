import { verifySignedLicense } from "../billing";
import { apiAction, apiErr } from "../handler";
import { Api, Auth, Billing, Rbac } from "@core/types";
import { v4 as uuid } from "uuid";
import {
  getActiveGeneratedEnvkeysByKeyableParentId,
  getDeleteKeyableParentProducer,
  deleteGraphObjects,
  authz,
  environmentCompositeId,
} from "@core/lib/graph";
import { pick } from "@core/lib/utils/pick";
import { graphKey } from "../db";
import produce from "immer";
import { getPubkeyHash } from "@core/lib/client";
import { sha256 } from "@core/lib/crypto/utils";

apiAction<
  Api.Action.RequestActions["CreateServer"],
  Api.Net.ApiResultTypes["CreateServer"]
>({
  type: Api.ActionType.CREATE_SERVER,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (
    { payload: { environmentId } },
    orgGraph,
    userGraph,
    auth,
    now,
    requestParams,
    transactionConn
  ) => {
    let license: Billing.License;
    try {
      license = verifySignedLicense(auth.org.id, auth.org.signedLicense, now);
    } catch (err) {
      throw await apiErr(transactionConn, (err as Error).message, 401);
    }

    const numActive = Object.values(
      getActiveGeneratedEnvkeysByKeyableParentId(orgGraph)
    ).length;

    if (numActive >= license.maxEnvkeys) {
      return false;
    }

    return authz.canCreateServer(userGraph, auth.user.id, environmentId);
  },
  graphHandler: async ({ type: actionType, payload }, orgGraph, auth, now) => {
    const id = uuid(),
      server: Api.Db.Server = {
        type: "server",
        id,
        ...graphKey(auth.org.id, "server", id),
        ...pick(["appId", "environmentId", "name"], payload),
        createdAt: now,
        updatedAt: now,
      };

    const scope: Rbac.OrgAccessScope = {
      keyableParentIds: new Set([server.id]),
    };

    const environment = orgGraph[server.environmentId] as Api.Db.Environment;

    return {
      type: "graphHandlerResult",
      handlerContext: {
        type: actionType,
        createdId: server.id,
      },
      graph: {
        ...orgGraph,
        [server.id]: server,
      },
      orgAccessChangeScope: scope,
      logTargetIds: [
        server.id,
        environment.environmentRoleId,
        environment.isSub ? environmentCompositeId(environment) : undefined,
      ].filter((id): id is string => Boolean(id)),
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteServer"],
  Api.Net.ApiResultTypes["DeleteServer"]
>({
  type: Api.ActionType.DELETE_SERVER,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload: { id } }, orgGraph, userGraph, auth) =>
    authz.canDeleteServer(userGraph, auth.user.id, id),
  graphHandler: async (action, orgGraph, auth, now) => {
    const server = orgGraph[action.payload.id] as Api.Db.Server;
    const environment = orgGraph[server.environmentId] as Api.Db.Environment;

    const scope: Rbac.OrgAccessScope = {
      keyableParentIds: new Set([action.payload.id]),
    };

    return {
      type: "graphHandlerResult",
      graph: produce(
        orgGraph,
        getDeleteKeyableParentProducer(action.payload.id, now)
      ),
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [
        server.id,
        environment.environmentRoleId,
        environment.isSub ? environmentCompositeId(environment) : undefined,
      ].filter((id): id is string => Boolean(id)),
    };
  },
});

apiAction<
  Api.Action.RequestActions["CreateLocalKey"],
  Api.Net.ApiResultTypes["CreateLocalKey"]
>({
  type: Api.ActionType.CREATE_LOCAL_KEY,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (
    { payload: { environmentId } },
    orgGraph,
    userGraph,
    auth,
    now,
    requestParams,
    transactionConn
  ) => {
    let license: Billing.License;
    try {
      license = verifySignedLicense(auth.org.id, auth.org.signedLicense, now);
    } catch (err) {
      throw await apiErr(transactionConn, (err as Error).message, 401);
    }

    const numActive = Object.values(
      getActiveGeneratedEnvkeysByKeyableParentId(orgGraph)
    ).length;

    if (numActive >= license.maxEnvkeys) {
      return false;
    }

    return authz.canCreateLocalKey(userGraph, auth.user.id, environmentId);
  },
  graphHandler: async ({ type: actionType, payload }, orgGraph, auth, now) => {
    const id = uuid(),
      localKey: Api.Db.LocalKey = {
        type: "localKey",
        id,
        ...graphKey(auth.org.id, "localKey", id),
        ...pick(["appId", "environmentId", "name"], payload),
        userId: auth.user.id,
        createdAt: now,
        updatedAt: now,
      };

    const environment = orgGraph[localKey.environmentId] as Api.Db.Environment;

    const scope: Rbac.OrgAccessScope = {
      keyableParentIds: new Set([localKey.id]),
    };

    return {
      type: "graphHandlerResult",
      handlerContext: {
        type: actionType,
        createdId: localKey.id,
      },
      graph: {
        ...orgGraph,
        [localKey.id]: localKey,
      },
      logTargetIds: [
        localKey.id,
        environment.environmentRoleId,
        "locals",
      ].filter((id): id is string => Boolean(id)),
      orgAccessChangeScope: scope,
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteLocalKey"],
  Api.Net.ApiResultTypes["DeleteLocalKey"]
>({
  type: Api.ActionType.DELETE_LOCAL_KEY,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload: { id } }, orgGraph, userGraph, auth) =>
    authz.canDeleteLocalKey(userGraph, auth.user.id, id),
  graphHandler: async (action, orgGraph, auth, now) => {
    const localKey = orgGraph[action.payload.id] as Api.Db.LocalKey;
    const environment = orgGraph[localKey.environmentId] as Api.Db.Environment;

    const scope: Rbac.OrgAccessScope = {
      keyableParentIds: new Set([action.payload.id]),
    };
    return {
      type: "graphHandlerResult",
      graph: produce(
        orgGraph,
        getDeleteKeyableParentProducer(action.payload.id, now)
      ),
      logTargetIds: [
        localKey.id,
        environment.environmentRoleId,
        "locals",
      ].filter((id): id is string => Boolean(id)),
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
    };
  },
});

apiAction<
  Api.Action.RequestActions["GenerateKey"],
  Api.Net.ApiResultTypes["GenerateKey"]
>({
  type: Api.ActionType.GENERATE_KEY,
  graphAction: true,
  authenticated: true,

  graphAuthorizer: async (
    { payload: { keyableParentId } },
    orgGraph,
    userGraph,
    auth,
    now,
    requestParams,
    transactionConn
  ) => {
    let license: Billing.License;
    try {
      license = verifySignedLicense(auth.org.id, auth.org.signedLicense, now);
    } catch (err) {
      throw await apiErr(transactionConn, (err as Error).message, 401);
    }

    const numActive = Object.values(
      getActiveGeneratedEnvkeysByKeyableParentId(orgGraph)
    ).length;

    const existingEnvkey = getActiveGeneratedEnvkeysByKeyableParentId(orgGraph)[
      keyableParentId
    ] as Api.Db.GeneratedEnvkey;

    if (numActive - (existingEnvkey ? 1 : 0) >= license.maxEnvkeys) {
      return false;
    }

    return authz.canGenerateKey(userGraph, auth.user.id, keyableParentId);
  },
  graphHandler: async (
    { type: actionType, payload, meta },
    orgGraph,
    auth,
    now
  ) => {
    let [updatedGraph, generatedEnvkey] = generateKey(
      orgGraph,
      auth,
      now,
      payload
    );

    const existingEnvkey = getActiveGeneratedEnvkeysByKeyableParentId(orgGraph)[
      payload.keyableParentId
    ] as Api.Db.GeneratedEnvkey | undefined;

    if (existingEnvkey) {
      updatedGraph = deleteGraphObjects(updatedGraph, [existingEnvkey.id], now);
    }

    const keyableParent = orgGraph[
      payload.keyableParentId
    ] as Api.Db.KeyableParent;
    const environment = orgGraph[
      keyableParent.environmentId
    ] as Api.Db.Environment;

    const scope: Rbac.OrgAccessScope = {
      keyableParentIds: new Set([generatedEnvkey.keyableParentId]),
    };

    const logTargetIds = [
      generatedEnvkey.id,
      payload.keyableParentId,
      environment.environmentRoleId,
    ];

    if (keyableParent.type == "localKey") {
      logTargetIds.push("locals");
    } else if (environment.isSub) {
      logTargetIds.push(environmentCompositeId(environment));
    }

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      handlerContext: {
        type: actionType,
        createdId: generatedEnvkey.id,
      },
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds,
    };
  },
});

apiAction<
  Api.Action.RequestActions["RevokeKey"],
  Api.Net.ApiResultTypes["RevokeKey"]
>({
  type: Api.ActionType.REVOKE_KEY,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload: { id } }, orgGraph, userGraph, auth) =>
    authz.canRevokeKey(userGraph, auth.user.id, { generatedEnvkeyId: id }),
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const generatedEnvkey = orgGraph[payload.id] as Api.Db.GeneratedEnvkey;
    const keyableParent = orgGraph[
      generatedEnvkey.keyableParentId
    ] as Api.Db.KeyableParent;
    const environment = orgGraph[
      keyableParent.environmentId
    ] as Api.Db.Environment;
    const scope: Rbac.OrgAccessScope = {
      keyableParentIds: new Set([generatedEnvkey.keyableParentId]),
    };

    const logTargetIds = [
      generatedEnvkey.id,
      generatedEnvkey.keyableParentId,
      environment.environmentRoleId,
    ];

    if (keyableParent.type == "localKey") {
      logTargetIds.push("locals");
    } else if (environment.isSub) {
      logTargetIds.push(environmentCompositeId(environment));
    }

    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(orgGraph, [generatedEnvkey.id], now),
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds,
    };
  },
});

const generateKey = (
  orgGraph: Api.Graph.OrgGraph,
  auth: Auth.DefaultAuthContext,
  now: number,
  payload: Api.Net.ApiParamTypes["GenerateKey"]
): [Api.Graph.OrgGraph, Api.Db.GeneratedEnvkey] => {
  const keyableParent = orgGraph[
    payload.keyableParentId
  ] as Api.Db.KeyableParent;

  const id = uuid(),
    generatedEnvkey: Api.Db.GeneratedEnvkey = {
      type: "generatedEnvkey",
      id,
      ...graphKey(auth.org.id, "generatedEnvkey", payload.envkeyIdPart),
      ...pick(
        [
          "appId",
          "encryptedPrivkey",
          "envkeyIdPart",
          "keyableParentId",
          "keyableParentType",
          "pubkey",
          "envkeyIdPart",
        ],
        payload
      ),
      environmentId: keyableParent.environmentId,
      signedTrustedRoot: payload.signedTrustedRoot,
      trustedRootUpdatedAt: now,
      envkeyShort: payload.envkeyIdPart.substr(0, 4),
      envkeyIdPartHash: sha256(payload.envkeyIdPart),
      creatorId: auth.user.id,
      creatorDeviceId:
        auth.type == "tokenAuthContext" ? auth.orgUserDevice.id : undefined,
      signedById:
        auth.type == "tokenAuthContext" ? auth.orgUserDevice.id : auth.user.id,
      pubkeyId: getPubkeyHash(payload.pubkey),
      pubkeyUpdatedAt: now,
      blobsUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    };

  let updatedGraph: Api.Graph.OrgGraph = {
    ...orgGraph,
    [generatedEnvkey.id]: generatedEnvkey,
  };

  return [updatedGraph, generatedEnvkey];
};

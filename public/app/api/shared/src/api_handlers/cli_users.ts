import { verifySignedLicense } from "../billing";
import {
  authz,
  getActiveCliUsers,
  getEnvParentPermissions,
  graphTypes,
} from "@core/lib/graph";
import * as R from "ramda";
import produce from "immer";
import { pick } from "@core/lib/utils/pick";
import { apiAction, apiErr } from "../handler";
import { Api, Auth, Billing, Rbac } from "@core/types";
import { v4 as uuid } from "uuid";
import { graphKey, getDb } from "../db";
import { getPubkeyHash } from "@core/lib/client";
import { getOrgGraph, getApiUserGraph, deleteUser } from "../graph";
import { env } from "../env";
import { sha256 } from "@core/lib/crypto/utils";

apiAction<
  Api.Action.RequestActions["CreateCliUser"],
  Api.Net.ApiResultTypes["CreateCliUser"],
  Auth.TokenAuthContext
>({
  type: Api.ActionType.CREATE_CLI_USER,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (
    { payload },
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

    const numActive = getActiveCliUsers(orgGraph).length;

    if (numActive >= license.maxCliUsers) {
      return false;
    }

    return authz.canCreateCliUser(userGraph, auth.user.id, payload);
  },

  graphHandler: async (action, orgGraph, auth, now) => {
    const cliUserId = uuid(),
      cliUser: Api.Db.CliUser = {
        type: "cliUser",
        id: cliUserId,
        ...graphKey(auth.org.id, "cliUser", cliUserId),
        ...pick(
          ["name", "orgRoleId", "pubkey", "encryptedPrivkey"],
          action.payload
        ),
        pubkeyId: getPubkeyHash(action.payload.pubkey),
        creatorId: auth.user.id,
        creatorDeviceId: auth.orgUserDevice.id,
        signedById: auth.orgUserDevice.id,
        pubkeyUpdatedAt: now,
        signedTrustedRoot: action.payload.signedTrustedRoot,
        trustedRootUpdatedAt: now,
        orgRoleUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      cliUserPointer: Api.Db.CliKeyPointer = {
        type: "cliKeyPointer",
        pkey: sha256(action.payload.cliKeyIdPart),
        skey: "cliKeyPointer",
        orgId: auth.org.id,
        userId: cliUserId,
        createdAt: now,
        updatedAt: now,
      },
      appUserGrants = action.payload.appUserGrants || [],
      updatedGraph = produce(orgGraph, (draft) => {
        draft[cliUserId] = cliUser;

        for (let appUserGrantParams of appUserGrants) {
          const appUserGrantId = uuid(),
            appUserGrant: Api.Db.AppUserGrant = {
              type: "appUserGrant",
              id: appUserGrantId,
              ...graphKey(auth.org.id, "appUserGrant", appUserGrantId),
              ...pick(["appId", "appRoleId"], appUserGrantParams),
              userId: cliUser.id,
              createdAt: now,
              updatedAt: now,
            };
          draft[appUserGrantId] = appUserGrant;
        }
      });

    const scope: Rbac.OrgAccessScope = {
      userIds: new Set([cliUserId]),
      envParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      handlerContext: {
        type: action.type,
        createdId: cliUserId,
      },
      transactionItems: {
        puts: [cliUserPointer],
      },
      logTargetIds: [cliUserId],
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
    };
  },
});

apiAction<
  Api.Action.RequestActions["RenameCliUser"],
  Api.Net.ApiResultTypes["RenameCliUser"]
>({
  type: Api.ActionType.RENAME_CLI_USER,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload: { id } }, orgGraph, userGraph, auth) =>
    authz.canRenameCliUser(userGraph, auth.user.id, id),
  graphHandler: async ({ payload: { id, name } }, orgGraph, auth, now) => {
    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [id]: { ...orgGraph[id], name },
      },
      logTargetIds: [id],
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteCliUser"],
  Api.Net.ApiResultTypes["DeleteCliUser"]
>({
  type: Api.ActionType.DELETE_CLI_USER,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload: { id } }, orgGraph, userGraph, auth) =>
    authz.canDeleteCliUser(userGraph, auth.user.id, id),
  graphHandler: async (action, orgGraph, auth, now) => {
    const scope: Rbac.OrgAccessScope = {
      userIds: new Set([action.payload.id]),
      envParentIds: "all",
      keyableParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: deleteUser(orgGraph, action.payload.id, auth, now),
      logTargetIds: [action.payload.id],
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
    };
  },
});

apiAction<
  Api.Action.RequestActions["AuthenticateCliKey"],
  Api.Net.ApiResultTypes["AuthenticateCliKey"]
>({
  type: Api.ActionType.AUTHENTICATE_CLI_KEY,
  graphAction: false,
  authenticated: false,
  handler: async ({ type, payload }, now, requestParams, transactionConn) => {
    const cliKeyPointer = await getDb<Api.Db.CliKeyPointer>({
      pkey: sha256(payload.cliKeyIdPart),
      skey: "cliKeyPointer",
    });

    if (!cliKeyPointer) {
      console.log("cli key pointer not found");
      throw await apiErr(transactionConn, "not found", 404);
    }

    const cliUser = await getDb<Api.Db.CliUser>(
      graphKey(cliKeyPointer.orgId, "cliUser", cliKeyPointer.userId)
    );
    if (!cliUser || cliUser.deactivatedAt) {
      console.log("cli user not found");
      throw await apiErr(transactionConn, "not found", 404);
    }

    const graph = await getOrgGraph(cliKeyPointer.orgId).then((orgGraph) =>
        getApiUserGraph(
          orgGraph,
          cliKeyPointer.orgId,
          cliUser.id,
          undefined,
          now
        )
      ),
      org = graph[cliKeyPointer.orgId] as Api.Db.Org;

    return {
      type: "handlerResult",
      response: {
        type: "authenticateCliKeyResult",
        orgId: cliKeyPointer.orgId,
        userId: cliKeyPointer.userId,
        graph,
        graphUpdatedAt: org.graphUpdatedAt,
        timestamp: now,
        signedTrustedRoot: cliUser.signedTrustedRoot,
        name: cliUser.name,
        encryptedPrivkey: cliUser.encryptedPrivkey,
        ...(env.IS_CLOUD_ENVKEY
          ? {
              hostType: <const>"cloud",
            }
          : {
              hostType: <const>"self-hosted",
              deploymentTag: env.DEPLOYMENT_TAG,
            }),
      },
      logTargetIds: [],
      handlerContext: {
        type,
        cliUser,
      },
    };
  },
});

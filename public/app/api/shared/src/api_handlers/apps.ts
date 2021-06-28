import { apiAction } from "../handler";
import { Api, Rbac } from "@core/types";
import { graphKey } from "../db";
import { pick } from "@core/lib/utils/pick";
import {
  graphTypes,
  getAppUserGrantsByComposite,
  getOrphanedLocalKeyIdsForUser,
  deleteGraphObjects,
  getDeleteAppProducer,
  authz,
  getConnectedBlocksForApp,
} from "@core/lib/graph";
import { v4 as uuid } from "uuid";
import * as R from "ramda";
import produce from "immer";
import { log } from "@core/lib/utils/logger";

apiAction<
  Api.Action.RequestActions["CreateApp"],
  Api.Net.ApiResultTypes["CreateApp"]
>({
  type: Api.ActionType.CREATE_APP,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (action, orgGraph, userGraph, auth) =>
    authz.canCreateApp(userGraph, auth.user.id),
  graphHandler: async (action, orgGraph, auth, now) => {
    const appId = uuid(),
      { environmentRoles } = graphTypes(orgGraph),
      defaultEnvironmentRoles = environmentRoles.filter(
        R.propEq("defaultAllApps", true as boolean)
      ),
      environments = defaultEnvironmentRoles.map<Api.Db.Environment>(
        ({ id: environmentRoleId }) => {
          const id = uuid();
          return {
            type: "environment",
            id,
            ...graphKey(auth.org.id, "environment", id),
            envParentId: appId,
            environmentRoleId,
            isSub: false,
            settings: {},
            createdAt: now,
            updatedAt: now,
          };
        }
      ),
      allAppRoles = graphTypes(orgGraph).appRoles,
      defaultAppRoles = allAppRoles.filter(
        R.propEq("defaultAllApps", true as boolean)
      ),
      includedAppRoles = defaultAppRoles.map<Api.Db.IncludedAppRole>(
        ({ id: appRoleId }) => {
          const id = uuid();
          return {
            type: "includedAppRole",
            id,
            ...graphKey(auth.org.id, "includedAppRole", id),
            appId,
            appRoleId,
            createdAt: now,
            updatedAt: now,
          };
        }
      ),
      app: Api.Db.App = {
        type: "app",
        id: appId,
        ...graphKey(auth.org.id, "app", appId),
        ...pick(["name", "settings"], action.payload),
        localsUpdatedAtByUserId: {},
        localsEncryptedBy: {},
        localsReencryptionRequiredAt: {},
        createdAt: now,
        updatedAt: now,
      };

    const { orgUsers, cliUsers } = graphTypes(orgGraph);
    const users = [...orgUsers, ...cliUsers];

    return {
      type: "graphHandlerResult",
      handlerContext: {
        type: action.type,
        createdId: appId,
      },
      graph: {
        ...orgGraph,
        ...R.indexBy(R.prop("id"), [app, ...environments, ...includedAppRoles]),
      },
      logTargetIds: [app.id],
      orgAccessChangeScope: {
        envParentIds: new Set([appId]),
        userIds: new Set(
          users
            .filter(
              (user) => (orgGraph[user.orgRoleId] as Rbac.OrgRole).autoAppRoleId
            )
            .map(R.prop("id"))
        ),
      },
    };
  },
});

apiAction<
  Api.Action.RequestActions["RenameApp"],
  Api.Net.ApiResultTypes["RenameApp"]
>({
  type: Api.ActionType.RENAME_APP,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload: { id } }, orgGraph, userGraph, auth) =>
    authz.canRenameApp(userGraph, auth.user.id, id),
  graphHandler: async ({ payload: { id, name } }, orgGraph, auth, now) => {
    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [id]: {
          ...orgGraph[id],
          name,
        },
      },
      logTargetIds: [id],
    };
  },
});

apiAction<
  Api.Action.RequestActions["UpdateAppSettings"],
  Api.Net.ApiResultTypes["UpdateAppSettings"]
>({
  type: Api.ActionType.UPDATE_APP_SETTINGS,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload: { id } }, orgGraph, userGraph, auth) =>
    authz.canUpdateAppSettings(userGraph, auth.user.id, id),
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const app = orgGraph[payload.id] as Api.Db.App;

    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [app.id]: { ...app, settings: payload.settings },
      },
      logTargetIds: [payload.id],
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteApp"],
  Api.Net.ApiResultTypes["DeleteApp"]
>({
  type: Api.ActionType.DELETE_APP,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload: { id } }, orgGraph, userGraph, auth) =>
    authz.canDeleteApp(userGraph, auth.user.id, id),
  graphHandler: async (action, orgGraph, auth, now) => {
    const scope: Rbac.OrgAccessScope = {
      envParentIds: new Set([
        action.payload.id,
        ...getConnectedBlocksForApp(orgGraph, action.payload.id).map(
          R.prop("id")
        ),
      ]),
      userIds: "all",
      keyableParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: produce(orgGraph, getDeleteAppProducer(action.payload.id, now)),
      transactionItems: {
        hardDeleteEncryptedBlobParams: [
          {
            orgId: auth.org.id,
            envParentId: action.payload.id,
            blobType: "env",
          },
          {
            orgId: auth.org.id,
            envParentId: action.payload.id,
            blobType: "changeset",
          },
        ],
      },
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [action.payload.id],
    };
  },
});

apiAction<
  Api.Action.RequestActions["GrantAppAccess"],
  Api.Net.ApiResultTypes["GrantAppAccess"]
>({
  type: Api.ActionType.GRANT_APP_ACCESS,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) =>
    authz.canGrantAppRoleToUser(userGraph, auth.user.id, payload),

  graphHandler: async ({ type: actionType, payload }, orgGraph, auth, now) => {
    let updatedGraph: Api.Graph.OrgGraph = orgGraph;

    const existingAppGrant = getAppUserGrantsByComposite(orgGraph)[
      R.props(["userId", "appId"], payload).join("|")
    ] as Api.Db.AppUserGrant | undefined;

    log("", { existingAppGrant });
    if (existingAppGrant) {
      log("existing app role", orgGraph[existingAppGrant?.appRoleId]);
    }

    log("new app role", orgGraph[payload.appRoleId]);

    if (existingAppGrant) {
      updatedGraph = deleteGraphObjects(orgGraph, [existingAppGrant.id], now);
    }

    const appUserGrantId = uuid(),
      appUserGrant: Api.Db.AppUserGrant = {
        type: "appUserGrant",
        id: appUserGrantId,
        ...graphKey(auth.org.id, "appUserGrant", appUserGrantId),
        ...pick(["appId", "appRoleId", "userId"], payload),
        createdAt: now,
        updatedAt: now,
      };

    updatedGraph = {
      ...updatedGraph,
      [appUserGrantId]: appUserGrant,
    };

    const orphanedLocalKeyIds = getOrphanedLocalKeyIdsForUser(
      updatedGraph,
      auth.user.id
    );
    if (orphanedLocalKeyIds.length > 0) {
      updatedGraph = deleteGraphObjects(updatedGraph, orphanedLocalKeyIds, now);
    }

    const scope: Rbac.OrgAccessScope = {
      envParentIds: new Set([
        appUserGrant.appId,
        ...getConnectedBlocksForApp(orgGraph, appUserGrant.appId).map(
          R.prop("id")
        ),
      ]),
      userIds: new Set([appUserGrant.userId]),
      environmentIds: "all",
      keyableParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      handlerContext: {
        type: actionType,
        createdId: appUserGrantId,
      },
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [appUserGrant.appId, appUserGrant.userId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RemoveAppAccess"],
  Api.Net.ApiResultTypes["RemoveAppAccess"]
>({
  type: Api.ActionType.REMOVE_APP_ACCESS,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload: { id } }, orgGraph, userGraph, auth) =>
    authz.canRemoveAppUserAccess(userGraph, auth.user.id, {
      appUserGrantId: id,
    }),
  graphHandler: async (action, orgGraph, auth, now) => {
    const targetAppUserGrant = orgGraph[
        action.payload.id
      ] as Api.Db.AppUserGrant,
      localKeys = graphTypes(orgGraph).localKeys.filter(
        R.whereEq({
          userId: targetAppUserGrant.userId,
          appId: targetAppUserGrant.appId,
        })
      );

    const connectedBlockIds = getConnectedBlocksForApp(
      orgGraph,
      targetAppUserGrant.appId
    ).map(R.prop("id"));

    const scope: Rbac.OrgAccessScope = {
      envParentIds: new Set([targetAppUserGrant.appId, ...connectedBlockIds]),
      environmentIds: "all",
      userIds: new Set([targetAppUserGrant.userId]),
      keyableParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(
        orgGraph,
        [targetAppUserGrant.id, ...localKeys.map(R.prop("id"))],
        now
      ),
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [targetAppUserGrant.appId, targetAppUserGrant.userId],
    };
  },
});

import {
  getEnvParentPermissions,
  getIncludedAppRolesByComposite,
  getOrgUsersByOrgRoleId,
  getCliUsersByOrgRoleId,
  getAppUserGrantsByAppRoleId,
  getOrgRolesByAutoAppRoleId,
  getOrgRolesByExtendsId,
  getAppRolesByExtendsId,
  graphTypes,
  getIncludedAppRolesByAppRoleId,
  getAppRoleEnvironmentRolesByAppRoleId,
  getEnvironmentsByRoleId,
  getAppRoleEnvironmentRolesByEnvironmentRoleId,
  deleteGraphObjects,
  getUpdateOrgRoleProducer,
  getUpdateAppRoleProducer,
  getUpdateEnvironmentRoleProducer,
  getConnectedBlocksForApp,
} from "@core/lib/graph";
import { apiAction } from "../handler";
import { Api, Rbac, Client } from "@core/types";
import { v4 as uuid } from "uuid";
import { pickDefined } from "@core/lib/utils/object";
import produce from "immer";
import * as R from "ramda";
import { graphKey } from "../db";

apiAction<
  Api.Action.RequestActions["RbacCreateOrgRole"],
  Api.Net.ApiResultTypes["RbacCreateOrgRole"]
>({
  type: Api.ActionType.RBAC_CREATE_ORG_ROLE,
  authenticated: true,
  graphAction: true,
  rbacUpdate: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    return (
      orgRoleParamsValid(userGraph, payload) &&
      auth.orgPermissions.has("org_manage_org_roles")
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const orgRoles = graphTypes(orgGraph).orgRoles;

    const id = uuid(),
      orgRole: Api.Db.OrgRole = {
        type: "orgRole",
        id,
        ...graphKey(auth.org.id, "orgRole", id),
        isDefault: false,
        ...pickDefined(
          ["autoAppRoleId", "name", "description", "canHaveCliUsers"],
          payload
        ),
        canManageAllOrgRoles: payload.canManageAllOrgRoles as any,
        canInviteAllOrgRoles: payload.canInviteAllOrgRoles as any,
        canManageOrgRoleIds: payload.canManageOrgRoleIds as any,
        canInviteOrgRoleIds: payload.canInviteOrgRoleIds as any,
        permissions: payload.permissions as any,
        extendsRoleId: payload.extendsRoleId as any,
        addPermissions: payload.addPermissions as any,
        removePermissions: payload.removePermissions as any,
        orderIndex: orgRoles[orgRoles.length - 1].orderIndex + 1,
        createdAt: now,
        updatedAt: now,
      },
      updatedGraph = produce(orgGraph, (draft) => {
        draft[orgRole.id] = orgRole;

        if (payload.canBeManagedByOrgRoleIds) {
          for (let managingOrgRoleId of payload.canBeManagedByOrgRoleIds) {
            const managingOrgRoleDraft = draft[
              managingOrgRoleId
            ] as Api.Db.OrgRole;
            if (!managingOrgRoleDraft.canManageAllOrgRoles) {
              managingOrgRoleDraft.canManageOrgRoleIds.push(orgRole.id);
            }
          }
        }

        if (payload.canBeInvitedByOrgRoleIds) {
          for (let invitingOrgRoleId of payload.canBeInvitedByOrgRoleIds) {
            const invitingOrgRoleDraft = draft[
              invitingOrgRoleId
            ] as Api.Db.OrgRole;
            if (!invitingOrgRoleDraft.canInviteAllOrgRoles) {
              invitingOrgRoleDraft.canInviteOrgRoleIds.push(orgRole.id);
            }
          }
        }
      });

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      logTargetIds: [orgRole.id],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RbacDeleteOrgRole"],
  Api.Net.ApiResultTypes["RbacDeleteOrgRole"]
>({
  type: Api.ActionType.RBAC_DELETE_ORG_ROLE,
  authenticated: true,
  graphAction: true,
  rbacUpdate: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const orgRole = userGraph[payload.id];
    if (!orgRole || orgRole.type != "orgRole" || orgRole.isDefault) {
      return false;
    }

    const extendingOrgRoles =
      getOrgRolesByExtendsId(orgGraph)[orgRole.id] || [];
    if (extendingOrgRoles.length > 0) {
      return false;
    }

    const orgUsers = getOrgUsersByOrgRoleId(orgGraph)[orgRole.id] || [],
      cliUsers = getCliUsersByOrgRoleId(orgGraph)[orgRole.id] || [];
    if (orgUsers.length > 0 || cliUsers.length > 0) {
      return false;
    }

    return auth.orgPermissions.has("org_manage_org_roles");
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(orgGraph, [payload.id], now),
      logTargetIds: [payload.id],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RbacUpdateOrgRole"],
  Api.Net.ApiResultTypes["RbacUpdateOrgRole"]
>({
  type: Api.ActionType.RBAC_UPDATE_ORG_ROLE,
  authenticated: true,
  graphAction: true,
  rbacUpdate: true,

  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const orgRole = userGraph[payload.id];
    if (!orgRole || orgRole.type != "orgRole") {
      return false;
    }

    return (
      orgRoleParamsValid(userGraph, payload) &&
      auth.orgPermissions.has("org_manage_org_roles")
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const orgRole = orgGraph[payload.id] as Api.Db.OrgRole;

    return {
      type: "graphHandlerResult",
      graph: produce<Api.Graph.OrgGraph>(
        orgGraph,
        getUpdateOrgRoleProducer(payload, now)
      ),
      // TODO: narrow down rbac scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
      logTargetIds: [
        orgRole.id,
        ...[...graphTypes(orgGraph).orgUsers, ...graphTypes(orgGraph).cliUsers]
          .filter(({ orgRoleId }) => orgRoleId == payload.id)
          .map(R.prop("id")),
      ],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RbacCreateAppRole"],
  Api.Net.ApiResultTypes["RbacCreateAppRole"]
>({
  type: Api.ActionType.RBAC_CREATE_APP_ROLE,
  authenticated: true,
  graphAction: true,
  rbacUpdate: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    if (!payload.hasFullEnvironmentPermissions) {
      const environmentRoleIds = graphTypes(orgGraph).environmentRoles.map(
        R.prop("id")
      );

      if (
        !payload.appRoleEnvironmentRoles ||
        !R.equals(
          environmentRoleIds.sort(),
          Object.keys(payload.appRoleEnvironmentRoles).sort()
        )
      ) {
        return false;
      }
    }

    return (
      appRoleParamsValid(userGraph, payload) &&
      auth.orgPermissions.has("org_manage_app_roles")
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const appRoles = graphTypes(orgGraph).appRoles;

    const id = uuid(),
      appRole: Api.Db.AppRole = {
        type: "appRole",
        id,
        ...graphKey(auth.org.id, "appRole", id),
        isDefault: false,
        ...pickDefined(
          [
            "name",
            "description",
            "defaultAllApps",
            "canHaveCliUsers",
            "hasFullEnvironmentPermissions",
          ],
          payload
        ),
        canManageAppRoleIds: payload.canManageAppRoleIds as any,
        canInviteAppRoleIds: payload.canInviteAppRoleIds as any,
        permissions: payload.permissions as any,
        extendsRoleId: payload.extendsRoleId as any,
        addPermissions: payload.addPermissions as any,
        removePermissions: payload.removePermissions as any,
        orderIndex: appRoles[appRoles.length - 1].orderIndex + 1,
        createdAt: now,
        updatedAt: now,
      },
      updatedGraph = produce(orgGraph, (draft) => {
        draft[appRole.id] = appRole;

        if (payload.canBeManagedByAppRoleIds) {
          for (let managingAppRoleId of payload.canBeManagedByAppRoleIds) {
            const managingAppRoleDraft = draft[
              managingAppRoleId
            ] as Api.Db.AppRole;
            managingAppRoleDraft.canManageAppRoleIds.push(appRole.id);
          }
        }

        if (payload.canBeInvitedByAppRoleIds) {
          for (let invitingAppRoleId of payload.canBeInvitedByAppRoleIds) {
            const invitingAppRoleDraft = draft[
              invitingAppRoleId
            ] as Api.Db.AppRole;
            invitingAppRoleDraft.canInviteAppRoleIds.push(appRole.id);
          }
        }

        if (appRole.defaultAllApps) {
          const apps = graphTypes(orgGraph).apps;

          for (let app of apps) {
            const id = uuid(),
              includedAppRole: Api.Db.IncludedAppRole = {
                type: "includedAppRole",
                id,
                ...graphKey(auth.org.id, "includedAppRole", id),
                appId: app.id,
                appRoleId: appRole.id,
                createdAt: now,
                updatedAt: now,
              };
            draft[includedAppRole.id] = includedAppRole;
          }
        }

        for (let environmentRoleId in payload.appRoleEnvironmentRoles) {
          const id = uuid(),
            appRoleEnvironmentRole: Api.Db.AppRoleEnvironmentRole = {
              type: "appRoleEnvironmentRole",
              id,
              ...graphKey(auth.org.id, "appRoleEnvironmentRole", id),
              environmentRoleId,
              appRoleId: appRole.id,
              permissions: payload.appRoleEnvironmentRoles[environmentRoleId],
              createdAt: now,
              updatedAt: now,
            };

          draft[appRoleEnvironmentRole.id] = appRoleEnvironmentRole;
        }
      });

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      logTargetIds: [
        appRole.id,
        ...(appRole.defaultAllApps
          ? graphTypes(orgGraph).apps.map(R.prop("id"))
          : []),
      ],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RbacDeleteAppRole"],
  Api.Net.ApiResultTypes["RbacDeleteAppRole"]
>({
  type: Api.ActionType.RBAC_DELETE_APP_ROLE,
  authenticated: true,
  graphAction: true,
  rbacUpdate: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const appRole = userGraph[payload.id];
    if (!appRole || appRole.type != "appRole" || appRole.isDefault) {
      return false;
    }

    const extendingAppRoles =
      getAppRolesByExtendsId(orgGraph)[appRole.id] || [];
    if (extendingAppRoles.length > 0) {
      return false;
    }

    const autoOrgRoles = getOrgRolesByAutoAppRoleId(orgGraph)[appRole.id] || [];
    if (autoOrgRoles.length > 0) {
      return false;
    }

    const appUserGrants =
        getAppUserGrantsByAppRoleId(orgGraph)[appRole.id] || [],
      appGroupUsers = graphTypes(orgGraph).appGroupUsers.filter(
        R.propEq("appRoleId", appRole.id)
      );

    if (appUserGrants.length + appGroupUsers.length > 0) {
      return false;
    }

    return auth.orgPermissions.has("org_manage_app_roles");
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const appRole = orgGraph[payload.id] as Api.Db.AppRole;
    const includedAppRoles =
        getIncludedAppRolesByAppRoleId(orgGraph)[payload.id] || [],
      appRoleEnvironmentRoles =
        getAppRoleEnvironmentRolesByAppRoleId(orgGraph)[payload.id] || [];

    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(
        orgGraph,
        [
          payload.id,
          ...includedAppRoles.map(R.prop("id")),
          ...appRoleEnvironmentRoles.map(R.prop("id")),
        ],
        now
      ),
      logTargetIds: [
        appRole.id,
        ...(appRole.defaultAllApps
          ? graphTypes(orgGraph).apps.map(R.prop("id"))
          : includedAppRoles.map(R.prop("id"))),
      ],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RbacUpdateAppRole"],
  Api.Net.ApiResultTypes["RbacUpdateAppRole"]
>({
  type: Api.ActionType.RBAC_UPDATE_APP_ROLE,
  authenticated: true,
  graphAction: true,
  rbacUpdate: true,

  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const appRole = userGraph[payload.id];
    if (!appRole || appRole.type != "appRole") {
      return false;
    }

    if (appRole.hasFullEnvironmentPermissions) {
      if (payload.hasFullEnvironmentPermissions === false) {
        const environmentRoleIds = graphTypes(orgGraph).environmentRoles.map(
          R.prop("id")
        );

        if (
          !payload.appRoleEnvironmentRoles ||
          !R.equals(
            environmentRoleIds.sort(),
            Object.keys(payload.appRoleEnvironmentRoles).sort()
          )
        ) {
          return false;
        }
      }
    }

    return (
      appRoleParamsValid(userGraph, payload) &&
      auth.orgPermissions.has("org_manage_app_roles")
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const appRole = orgGraph[payload.id] as Api.Db.AppRole;
    const includedAppRoles =
      getIncludedAppRolesByAppRoleId(orgGraph)[payload.id] || [];
    return {
      type: "graphHandlerResult",
      graph: produce(orgGraph, getUpdateAppRoleProducer(payload, now)),
      // TODO: narrow down rbac scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
      logTargetIds: [
        appRole.id,
        ...(appRole.defaultAllApps
          ? graphTypes(orgGraph).apps.map(R.prop("id"))
          : includedAppRoles.map(R.prop("id"))),
      ],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RbacCreateIncludedAppRole"],
  Api.Net.ApiResultTypes["RbacCreateIncludedAppRole"]
>({
  type: Api.ActionType.RBAC_CREATE_INCLUDED_APP_ROLE,
  authenticated: true,
  graphAction: true,

  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const app = userGraph[payload.appId],
      appRole = userGraph[payload.appRoleId];
    if (!app || app.type != "app" || !appRole || appRole.type !== "appRole") {
      return false;
    }

    const existing =
      getIncludedAppRolesByComposite(orgGraph)[
        [payload.appRoleId, payload.appId].join("|")
      ];
    if (existing) {
      return false;
    }

    return getEnvParentPermissions(orgGraph, app.id, auth.user.id).has(
      "app_manage_included_roles"
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const id = uuid(),
      includedAppRole: Api.Db.IncludedAppRole = {
        type: "includedAppRole",
        id,
        ...graphKey(auth.org.id, "includedAppRole", id),
        ...pickDefined(["appId", "appRoleId"], payload),
        createdAt: now,
        updatedAt: now,
      };

    const scope: Rbac.OrgAccessScope = {
      userIds: "all",
      envParentIds: new Set([
        includedAppRole.appId,
        ...getConnectedBlocksForApp(orgGraph, includedAppRole.appId).map(
          R.prop("id")
        ),
      ]),
    };

    return {
      type: "graphHandlerResult",
      graph: { ...orgGraph, [includedAppRole.id]: includedAppRole },
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [includedAppRole.appRoleId, includedAppRole.appId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteIncludedAppRole"],
  Api.Net.ApiResultTypes["DeleteIncludedAppRole"]
>({
  type: Api.ActionType.DELETE_INCLUDED_APP_ROLE,
  authenticated: true,
  graphAction: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const includedAppRole = userGraph[payload.id];
    if (!includedAppRole || includedAppRole.type != "includedAppRole") {
      return false;
    }

    const appRole = userGraph[includedAppRole.appRoleId] as Api.Db.AppRole;
    if (appRole.isDefault && appRole.defaultName == "Admin") {
      return false;
    }

    const autoOrgRoles = getOrgRolesByAutoAppRoleId(orgGraph)[appRole.id] || [];
    if (autoOrgRoles.length > 0) {
      return false;
    }

    const appUserGrants =
      getAppUserGrantsByAppRoleId(orgGraph)[appRole.id] || [];
    if (appUserGrants.length > 0) {
      return false;
    }

    return getEnvParentPermissions(
      orgGraph,
      includedAppRole.appId,
      auth.user.id
    ).has("app_manage_included_roles");
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const includedAppRole = orgGraph[payload.id] as Api.Db.IncludedAppRole;

    const scope: Rbac.OrgAccessScope = {
      userIds: "all",
      envParentIds: new Set([
        includedAppRole.appId,
        ...getConnectedBlocksForApp(orgGraph, includedAppRole.appId).map(
          R.prop("id")
        ),
      ]),
      keyableParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(orgGraph, [payload.id], now),
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [includedAppRole.appRoleId, includedAppRole.appId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RbacCreateEnvironmentRole"],
  Api.Net.ApiResultTypes["RbacCreateEnvironmentRole"]
>({
  type: Api.ActionType.RBAC_CREATE_ENVIRONMENT_ROLE,
  authenticated: true,
  graphAction: true,
  rbacUpdate: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const appRoleIds = graphTypes(orgGraph)
      .appRoles.filter(R.complement(R.prop("hasFullEnvironmentPermissions")))
      .map(R.prop("id"));

    if (
      !R.equals(
        appRoleIds.sort(),
        Object.keys(payload.appRoleEnvironmentRoles).sort()
      )
    ) {
      return false;
    }

    return auth.orgPermissions.has("org_manage_environment_roles");
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const environmentRoles = graphTypes(orgGraph).environmentRoles;
    const id = uuid(),
      environmentRole = {
        type: "environmentRole",
        id,
        ...graphKey(auth.org.id, "environmentRole", id),
        isDefault: false,
        ...pickDefined(
          [
            "name",
            "description",
            "hasLocalKeys",
            "hasServers",
            "defaultAllApps",
            "defaultAllBlocks",
            "settings",
          ],
          payload
        ),
        orderIndex:
          environmentRoles[environmentRoles.length - 1].orderIndex + 1,
        createdAt: now,
        updatedAt: now,
      } as Api.Db.EnvironmentRole;

    const updatedGraph = produce(orgGraph, (draft) => {
      draft[environmentRole.id] = environmentRole;

      if (environmentRole.defaultAllApps) {
        const apps = graphTypes(orgGraph).apps;

        for (let app of apps) {
          const id = uuid(),
            environment: Api.Db.Environment = {
              type: "environment",
              id,
              ...graphKey(auth.org.id, "environment", id),
              envParentId: app.id,
              environmentRoleId: environmentRole.id,
              isSub: false,
              settings: {},
              createdAt: now,
              updatedAt: now,
            };

          draft[environment.id] = environment;
        }
      }

      if (environmentRole.defaultAllBlocks) {
        const blocks = graphTypes(orgGraph).blocks;

        for (let block of blocks) {
          const id = uuid(),
            environment: Api.Db.Environment = {
              type: "environment",
              id,
              ...graphKey(auth.org.id, "environment", id),
              envParentId: block.id,
              environmentRoleId: environmentRole.id,
              isSub: false,
              settings: {},
              createdAt: now,
              updatedAt: now,
            };

          draft[environment.id] = environment;
        }
      }

      for (let appRoleId in payload.appRoleEnvironmentRoles) {
        const id = uuid(),
          appRoleEnvironmentRole: Api.Db.AppRoleEnvironmentRole = {
            type: "appRoleEnvironmentRole",
            id,
            ...graphKey(auth.org.id, "appRoleEnvironmentRole", id),
            appRoleId,
            environmentRoleId: environmentRole.id,
            permissions: payload.appRoleEnvironmentRoles[appRoleId],
            createdAt: now,
            updatedAt: now,
          };

        draft[appRoleEnvironmentRole.id] = appRoleEnvironmentRole;
      }
    });

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      logTargetIds: [
        environmentRole.id,
        ...(environmentRole.defaultAllApps
          ? graphTypes(orgGraph).apps.map(R.prop("id"))
          : []),

        ...(environmentRole.defaultAllBlocks
          ? graphTypes(orgGraph).blocks.map(R.prop("id"))
          : []),
      ],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RbacDeleteEnvironmentRole"],
  Api.Net.ApiResultTypes["RbacDeleteEnvironmentRole"]
>({
  type: Api.ActionType.RBAC_DELETE_ENVIRONMENT_ROLE,
  authenticated: true,
  graphAction: true,
  rbacUpdate: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const environmentRole = userGraph[payload.id];
    if (
      !environmentRole ||
      environmentRole.type != "environmentRole" ||
      environmentRole.isDefault
    ) {
      return false;
    }

    return auth.orgPermissions.has("org_manage_environment_roles");
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const environmentRole = orgGraph[payload.id] as Api.Db.EnvironmentRole;
    const byType = graphTypes(orgGraph);
    const environments = getEnvironmentsByRoleId(orgGraph)[payload.id] ?? [],
      environmentIds = environments.map(R.prop("id")),
      environmentIdsSet = new Set(environmentIds),
      keyableParents = [...byType.servers, ...byType.localKeys].filter(
        ({ environmentId }) => environmentIdsSet.has(environmentId)
      ),
      keyableParentIds = keyableParents.map(R.prop("id")),
      keyableParentIdsSet = new Set(keyableParentIds),
      generatedEnvkeys = byType.generatedEnvkeys.filter(({ keyableParentId }) =>
        keyableParentIdsSet.has(keyableParentId)
      ),
      appRoleEnvironmentRoles =
        getAppRoleEnvironmentRolesByEnvironmentRoleId(orgGraph)[payload.id] ||
        [];

    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(
        orgGraph,
        [
          payload.id,
          ...environmentIds,
          ...appRoleEnvironmentRoles.map(R.prop("id")),
          ...keyableParentIds,
          ...generatedEnvkeys.map(R.prop("id")),
        ],
        now
      ),
      transactionItems: {
        hardDeleteEncryptedBlobParams: environments.flatMap((environment) => [
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
        ]),
      },
      logTargetIds: [
        environmentRole.id,
        ...R.uniq(environments.map(R.prop("envParentId"))),
      ],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RbacUpdateEnvironmentRole"],
  Api.Net.ApiResultTypes["RbacUpdateEnvironmentRole"]
>({
  type: Api.ActionType.RBAC_UPDATE_ENVIRONMENT_ROLE,
  authenticated: true,
  graphAction: true,
  rbacUpdate: true,

  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const environmentRole = userGraph[payload.id];
    if (!environmentRole || environmentRole.type != "environmentRole") {
      return false;
    }

    return auth.orgPermissions.has("org_manage_environment_roles");
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const environmentRole = orgGraph[payload.id] as Api.Db.EnvironmentRole;

    const environments = getEnvironmentsByRoleId(orgGraph)[payload.id] ?? [];

    return {
      type: "graphHandlerResult",
      graph: produce(orgGraph, getUpdateEnvironmentRoleProducer(payload, now)),
      // TODO: narrow down rbac scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
      logTargetIds: [
        environmentRole.id,
        ...R.uniq(environments.map(R.prop("envParentId"))),
      ],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RbacUpdateEnvironmentRoleSettings"],
  Api.Net.ApiResultTypes["RbacUpdateEnvironmentRoleSettings"]
>({
  type: Api.ActionType.RBAC_UPDATE_ENVIRONMENT_ROLE_SETTINGS,
  authenticated: true,
  graphAction: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const environmentRole = userGraph[payload.id];
    if (!environmentRole || environmentRole.type != "environmentRole") {
      return false;
    }

    return auth.orgPermissions.has("org_manage_environment_roles");
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const environmentRole = orgGraph[payload.id] as Api.Db.EnvironmentRole;
    const environments = getEnvironmentsByRoleId(orgGraph)[payload.id] ?? [];

    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [payload.id]: {
          ...environmentRole,
          settings: payload.settings,
        },
      },
      logTargetIds: [
        environmentRole.id,
        ...R.uniq(environments.map(R.prop("envParentId"))),
      ],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RbacReorderEnvironmentRoles"],
  Api.Net.ApiResultTypes["RbacReorderEnvironmentRoles"]
>({
  type: Api.ActionType.RBAC_REORDER_ENVIRONMENT_ROLES,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    if (!auth.orgPermissions.has("org_manage_environment_roles")) {
      return false;
    }

    const { environmentRoles } = graphTypes(orgGraph);
    for (let { id } of environmentRoles) {
      if (typeof payload[id] != "number") {
        return false;
      }
    }

    return true;
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const updatedGraph = produce(orgGraph, (draft) => {
      for (let id in payload) {
        const draftEnvironmentRole = draft[id] as Api.Db.EnvironmentRole;
        draftEnvironmentRole.orderIndex = payload[id];
      }
    });

    const { environments } = graphTypes(orgGraph);

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      logTargetIds: R.uniq(environments.map(R.prop("envParentId"))),
    };
  },
});

const appRoleParamsValid = (
    userGraph: Client.Graph.UserGraph,
    payload: Api.Net.ApiParamTypes["RbacCreateAppRole" | "RbacUpdateAppRole"]
  ) => {
    if (payload.canManageAppRoleIds) {
      for (let appRoleId of payload.canManageAppRoleIds) {
        const appRole = userGraph[appRoleId];
        if (!appRole || appRole.type != "appRole") {
          return false;
        }
      }
    }

    if (payload.canBeManagedByAppRoleIds) {
      for (let appRoleId of payload.canBeManagedByAppRoleIds) {
        const appRole = userGraph[appRoleId];
        if (!appRole || appRole.type != "appRole") {
          return false;
        }
      }
    }

    if (payload.extendsRoleId) {
      let extendsAppRole = userGraph[payload.extendsRoleId] as
        | Api.Db.AppRole
        | undefined;

      const circularIds = new Set(
        [
          payload.extendsRoleId,
          (payload as Api.Net.ApiParamTypes["RbacUpdateAppRole"]).id,
        ].filter(Boolean)
      );
      while (extendsAppRole) {
        if (!extendsAppRole || extendsAppRole.type != "appRole") {
          return false;
        }
        if (extendsAppRole.extendsRoleId) {
          if (circularIds.has(extendsAppRole.extendsRoleId)) {
            return false;
          }

          circularIds.add(extendsAppRole.extendsRoleId);

          extendsAppRole = userGraph[extendsAppRole.extendsRoleId] as
            | Api.Db.AppRole
            | undefined;
        } else {
          break;
        }
      }
    }

    if (payload.permissions) {
      for (let permission of payload.permissions) {
        if (!Rbac.appPermissions[permission]) {
          return false;
        }
      }
    }

    if (payload.addPermissions) {
      for (let permission of payload.addPermissions) {
        if (!Rbac.appPermissions[permission]) {
          return false;
        }
      }
    }

    if (payload.removePermissions) {
      for (let permission of payload.removePermissions) {
        if (!Rbac.appPermissions[permission]) {
          return false;
        }
      }
    }

    return true;
  },
  orgRoleParamsValid = (
    userGraph: Client.Graph.UserGraph,
    payload: Api.Net.ApiParamTypes["RbacCreateOrgRole" | "RbacUpdateOrgRole"]
  ) => {
    if (payload.autoAppRoleId) {
      const appRole = userGraph[payload.autoAppRoleId];
      if (!appRole || appRole.type != "appRole") {
        return false;
      }
    }

    if (payload.canManageOrgRoleIds) {
      for (let orgRoleId of payload.canManageOrgRoleIds) {
        const orgRole = userGraph[orgRoleId];
        if (!orgRole || orgRole.type != "orgRole") {
          return false;
        }
      }
    }

    if (payload.canBeManagedByOrgRoleIds) {
      for (let orgRoleId of payload.canBeManagedByOrgRoleIds) {
        const orgRole = userGraph[orgRoleId];
        if (!orgRole || orgRole.type != "orgRole") {
          return false;
        }
      }
    }

    if (payload.canInviteOrgRoleIds) {
      for (let orgRoleId of payload.canInviteOrgRoleIds) {
        const orgRole = userGraph[orgRoleId];
        if (!orgRole || orgRole.type != "orgRole") {
          return false;
        }
      }
    }

    if (payload.canBeInvitedByOrgRoleIds) {
      for (let orgRoleId of payload.canBeInvitedByOrgRoleIds) {
        const orgRole = userGraph[orgRoleId];
        if (!orgRole || orgRole.type != "orgRole") {
          return false;
        }
      }
    }

    if (payload.extendsRoleId) {
      let extendsOrgRole = userGraph[payload.extendsRoleId] as
        | Api.Db.OrgRole
        | undefined;

      const circularIds = new Set(
        [
          payload.extendsRoleId,
          (payload as Api.Net.ApiParamTypes["RbacUpdateOrgRole"]).id,
        ].filter(Boolean)
      );
      while (extendsOrgRole) {
        if (!extendsOrgRole || extendsOrgRole.type != "orgRole") {
          return false;
        }
        if (extendsOrgRole.extendsRoleId) {
          if (circularIds.has(extendsOrgRole.extendsRoleId)) {
            return false;
          }

          circularIds.add(extendsOrgRole.extendsRoleId);

          extendsOrgRole = userGraph[extendsOrgRole.extendsRoleId] as
            | Api.Db.OrgRole
            | undefined;
        } else {
          break;
        }
      }
    }

    if (payload.permissions) {
      for (let permission of payload.permissions) {
        if (!Rbac.orgPermissions[permission]) {
          return false;
        }
      }
    }

    if (payload.addPermissions) {
      for (let permission of payload.addPermissions) {
        if (!Rbac.orgPermissions[permission]) {
          return false;
        }
      }
    }

    if (payload.removePermissions) {
      for (let permission of payload.removePermissions) {
        if (!Rbac.orgPermissions[permission]) {
          return false;
        }
      }
    }

    return true;
  };

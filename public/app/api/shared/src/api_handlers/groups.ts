import { produce } from "immer";
import { apiAction } from "../handler";
import { Api, Model, Rbac } from "@core/types";
import * as R from "ramda";
import { v4 as uuid } from "uuid";
import {
  getEnvParentPermissions,
  getAppRoleForUserOrInvitee,
  getAppPermissions,
  graphTypes,
  getAppBlockGroupsByAppId,
  getAppGroupBlockGroupsByAppGroupId,
  getAppGroupBlocksByAppGroupId,
  getAppBlockGroupsByComposite,
  getAppGroupBlocksByComposite,
  getAppGroupBlockGroupsByComposite,
  getGroupMembershipsByGroupId,
  getGroupMembershipsByComposite,
  deleteGraphObjects,
  getDeleteGroupProducer,
} from "@core/lib/graph";
import { pick } from "@core/lib/utils/pick";
import { graphKey } from "../db";

apiAction<
  Api.Action.RequestActions["CreateGroup"],
  Api.Net.ApiResultTypes["CreateGroup"]
>({
  type: Api.ActionType.CREATE_GROUP,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    switch (payload.objectType) {
      case "orgUser":
        return auth.orgPermissions.has("org_manage_user_groups");
      case "app":
        return auth.orgPermissions.has("org_manage_app_groups");
      case "block":
        return auth.orgPermissions.has("org_manage_block_groups");
    }
  },
  graphHandler: async ({ type: actionType, payload }, orgGraph, auth, now) => {
    const id = uuid(),
      group: Api.Db.Group = {
        type: "group",
        id,
        ...graphKey(auth.org.id, "group", id),
        ...pick(["name", "objectType"], payload),
        createdAt: now,
        updatedAt: now,
      };

    return {
      type: "graphHandlerResult",
      handlerContext: {
        type: actionType,
        createdId: group.id,
      },
      graph: {
        ...orgGraph,
        [group.id]: group,
      },
      logTargetIds: [group.id],
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteGroup"],
  Api.Net.ApiResultTypes["DeleteGroup"]
>({
  type: Api.ActionType.DELETE_GROUP,
  graphAction: true,
  authenticated: true,
  reorderBlobsIfNeeded: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const group = userGraph[payload.id];
    if (!group || group.type != "group") {
      return false;
    }
    switch (group.objectType) {
      case "orgUser":
        return auth.orgPermissions.has("org_manage_user_groups");
      case "app":
        return auth.orgPermissions.has("org_manage_app_groups");
      case "block":
        return auth.orgPermissions.has("org_manage_block_groups");
    }

    return false;
  },
  graphHandler: async (action, orgGraph, auth, now) => {
    const group = orgGraph[action.payload.id] as Api.Db.Group;
    const objectIds = (
      getGroupMembershipsByGroupId(orgGraph)[action.payload.id] ?? []
    ).map(R.prop("objectId"));

    return {
      type: "graphHandlerResult",
      graph: produce(
        orgGraph,
        getDeleteGroupProducer<Api.Graph.OrgGraph>(action.payload.id, now)
      ),
      logTargetIds: [group.id],
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
    };
  },
});

apiAction<
  Api.Action.RequestActions["CreateGroupMembership"],
  Api.Net.ApiResultTypes["CreateGroupMembership"]
>({
  type: Api.ActionType.CREATE_GROUP_MEMBERSHIP,
  graphAction: true,
  authenticated: true,
  reorderBlobsIfNeeded: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const group = userGraph[payload.groupId],
      object = userGraph[payload.objectId],
      existingMembership = graphTypes(orgGraph).groupMemberships.filter(
        R.whereEq(R.pick(["groupId", "objectId"], payload))
      )[0];

    if (
      !group ||
      group.type != "group" ||
      existingMembership ||
      !object ||
      !["orgUser", "app", "block"].includes(object.type)
    ) {
      return false;
    }

    switch (group.objectType) {
      case "orgUser":
        return auth.orgPermissions.has("org_manage_user_groups");

      case "app":
        return auth.orgPermissions.has("org_manage_app_groups");

      case "block":
        return (
          auth.orgPermissions.has("org_manage_block_groups") &&
          typeof payload.orderIndex !== "undefined"
        );
    }

    return false;
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const membershipId = uuid(),
      membership: Api.Db.GroupMembership = {
        type: "groupMembership",
        id: membershipId,
        ...graphKey(auth.org.id, "groupMembership", membershipId),
        ...pick(["groupId", "objectId", "orderIndex"], payload),
        createdAt: now,
        updatedAt: now,
      };

    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [membershipId]: membership,
        [payload.groupId]: {
          ...orgGraph[payload.groupId],
          membershipsUpdatedAt: now,
        },
      },
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
      logTargetIds: [payload.groupId, payload.objectId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteGroupMembership"],
  Api.Net.ApiResultTypes["DeleteGroupMembership"]
>({
  type: Api.ActionType.DELETE_GROUP_MEMBERSHIP,
  graphAction: true,
  authenticated: true,
  reorderBlobsIfNeeded: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const membership = userGraph[payload.id];
    if (!membership || membership.type != "groupMembership") {
      return false;
    }

    const group = userGraph[membership.groupId] as Api.Db.Group;
    switch (group.objectType) {
      case "orgUser":
        return auth.orgPermissions.has("org_manage_user_groups");
      case "app":
        return auth.orgPermissions.has("org_manage_app_groups");
      case "block":
        return auth.orgPermissions.has("org_manage_block_groups");
    }

    return false;
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const membership = orgGraph[payload.id] as Model.GroupMembership;

    return {
      type: "graphHandlerResult",
      graph: {
        ...deleteGraphObjects(orgGraph, [payload.id], now),
        [membership.groupId]: {
          ...orgGraph[membership.groupId],
          membershipsUpdatedAt: now,
        },
      },
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
      logTargetIds: [membership.groupId, membership.objectId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["CreateAppUserGroup"],
  Api.Net.ApiResultTypes["CreateAppUserGroup"]
>({
  type: Api.ActionType.CREATE_APP_USER_GROUP,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const [app, targetAppRole, userGroup] = R.props(
        [payload.appId, payload.appRoleId, payload.userGroupId],
        userGraph
      ),
      existingAppUserGroup = graphTypes(orgGraph).appUserGroups.filter(
        R.eqBy(R.pick(["appId", "userGroupId"]), payload as any)
      )[0];

    if (
      !app ||
      app.type != "app" ||
      !targetAppRole ||
      targetAppRole.type != "appRole" ||
      !userGroup ||
      userGroup.type != "group" ||
      userGroup.objectType != "orgUser" ||
      existingAppUserGroup
    ) {
      return false;
    }

    const currentAppRole = getAppRoleForUserOrInvitee(
      orgGraph,
      app.id,
      auth.user.id
    );

    if (!currentAppRole) {
      return false;
    }

    const appPermissions = getAppPermissions(orgGraph, currentAppRole.id);

    return (
      auth.orgPermissions.has("org_manage_user_groups") &&
      appPermissions.has("app_manage_users") &&
      currentAppRole.canManageAppRoleIds.includes(targetAppRole.id)
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const id = uuid(),
      appUserGroup: Api.Db.AppUserGroup = {
        type: "appUserGroup",
        id,
        ...graphKey(auth.org.id, "appUserGroup", id),
        ...pick(["appId", "userGroupId", "appRoleId"], payload),
        createdAt: now,
        updatedAt: now,
      };

    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [appUserGroup.id]: appUserGroup,
      },
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
      logTargetIds: [appUserGroup.appId, appUserGroup.userGroupId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteAppUserGroup"],
  Api.Net.ApiResultTypes["DeleteAppUserGroup"]
>({
  type: Api.ActionType.DELETE_APP_USER_GROUP,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const appUserGroup = userGraph[payload.id] as Api.Db.AppUserGroup;
    if (!appUserGroup || appUserGroup.type != "appUserGroup") {
      return false;
    }

    return auth.orgPermissions.has("org_manage_user_groups");
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const appUserGroup = orgGraph[payload.id] as Api.Db.AppUserGroup;
    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(orgGraph, [payload.id], now),
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
      logTargetIds: [appUserGroup.appId, appUserGroup.userGroupId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["CreateAppGroupUserGroup"],
  Api.Net.ApiResultTypes["CreateAppGroupUserGroup"]
>({
  type: Api.ActionType.CREATE_APP_GROUP_USER_GROUP,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const [appGroup, appRole, userGroup] = R.props(
        [payload.appGroupId, payload.appRoleId, payload.userGroupId],
        userGraph
      ),
      existingAppGroupUserGroup = graphTypes(orgGraph).appUserGroups.filter(
        R.eqBy(R.pick(["appGroupId", "userGroupId"]), payload as any)
      )[0];

    if (
      !appGroup ||
      appGroup.type != "group" ||
      appGroup.objectType != "app" ||
      !appRole ||
      appRole.type != "appRole" ||
      !userGroup ||
      userGroup.type != "group" ||
      userGroup.objectType != "orgUser" ||
      existingAppGroupUserGroup
    ) {
      return false;
    }

    return (
      auth.orgPermissions.has("org_manage_user_groups") &&
      auth.orgPermissions.has("org_manage_app_groups")
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const id = uuid(),
      appGroupUserGroup: Api.Db.AppGroupUserGroup = {
        type: "appGroupUserGroup",
        id,
        ...graphKey(auth.org.id, "appGroupUserGroup", id),
        ...pick(["appGroupId", "userGroupId", "appRoleId"], payload),
        createdAt: now,
        updatedAt: now,
      };

    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [appGroupUserGroup.id]: appGroupUserGroup,
      },
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
      logTargetIds: [
        appGroupUserGroup.appGroupId,
        appGroupUserGroup.userGroupId,
      ],
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteAppGroupUserGroup"],
  Api.Net.ApiResultTypes["DeleteAppGroupUserGroup"]
>({
  type: Api.ActionType.DELETE_APP_GROUP_USER_GROUP,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const appGroupUserGroup = userGraph[payload.id];
    if (!appGroupUserGroup || appGroupUserGroup.type != "appGroupUserGroup") {
      return false;
    }

    return (
      auth.orgPermissions.has("org_manage_user_groups") &&
      auth.orgPermissions.has("org_manage_app_groups")
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const appGroupUserGroup = orgGraph[payload.id] as Api.Db.AppGroupUserGroup;
    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(orgGraph, [payload.id], now),
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
      logTargetIds: [
        appGroupUserGroup.appGroupId,
        appGroupUserGroup.userGroupId,
      ],
    };
  },
});

apiAction<
  Api.Action.RequestActions["CreateAppGroupUser"],
  Api.Net.ApiResultTypes["CreateAppGroupUser"]
>({
  type: Api.ActionType.CREATE_APP_GROUP_USER,
  graphAction: true,
  authenticated: true,

  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const [appGroup, appRole] = R.props(
        [payload.appGroupId, payload.appRoleId],
        userGraph
      ),
      user = userGraph[payload.userId] as Model.OrgUser | Model.CliUser,
      existingAppGroupUser = graphTypes(orgGraph).appGroupUsers.filter(
        R.eqBy(R.pick(["userId", "appGroupId"]), payload as any)
      )[0];

    if (
      !appGroup ||
      appGroup.type != "group" ||
      appGroup.objectType != "app" ||
      !appRole ||
      appRole.type != "appRole" ||
      !user ||
      !(user.type == "orgUser" || user.type == "cliUser") ||
      existingAppGroupUser
    ) {
      return false;
    }

    return (
      auth.orgPermissions.has("org_manage_app_groups") &&
      ((user.type == "orgUser" &&
        auth.orgPermissions.has("org_manage_users")) ||
        (user.type == "cliUser" &&
          auth.orgPermissions.has("org_manage_cli_users")))
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const id = uuid(),
      appGroupUser: Api.Db.AppGroupUser = {
        type: "appGroupUser",
        id,
        ...graphKey(auth.org.id, "appGroupUser", id),
        ...pick(["userId", "appGroupId", "appRoleId"], payload),
        createdAt: now,
        updatedAt: now,
      };

    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [appGroupUser.id]: appGroupUser,
      },
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
      logTargetIds: [appGroupUser.appGroupId, appGroupUser.userId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteAppGroupUser"],
  Api.Net.ApiResultTypes["DeleteAppGroupUser"]
>({
  type: Api.ActionType.DELETE_APP_GROUP_USER,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const appGroupUser = userGraph[payload.id];
    if (!appGroupUser || appGroupUser.type != "appGroupUser") {
      return false;
    }

    const user = userGraph[appGroupUser.userId] as
      | Model.OrgUser
      | Model.CliUser;

    return (
      auth.orgPermissions.has("org_manage_app_groups") &&
      ((user.type == "orgUser" &&
        auth.orgPermissions.has("org_manage_users")) ||
        (user.type == "cliUser" &&
          auth.orgPermissions.has("org_manage_cli_users")))
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const appGroupUser = orgGraph[payload.id] as Api.Db.AppGroupUser;
    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(orgGraph, [payload.id], now),
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
      logTargetIds: [appGroupUser.appGroupId, appGroupUser.userId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["CreateAppBlockGroup"],
  Api.Net.ApiResultTypes["CreateAppBlockGroup"]
>({
  type: Api.ActionType.CREATE_APP_BLOCK_GROUP,
  graphAction: true,
  authenticated: true,
  reorderBlobsIfNeeded: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const [app, blockGroup] = R.props(
        [payload.appId, payload.blockGroupId],
        userGraph
      ),
      existingAppBlockGroup = graphTypes(orgGraph).appBlockGroups.filter(
        R.eqBy(R.pick(["appId", "blockGroupId"]), payload as any)
      )[0];

    if (
      !app ||
      app.type != "app" ||
      !blockGroup ||
      blockGroup.type != "group" ||
      blockGroup.objectType != "block" ||
      existingAppBlockGroup
    ) {
      return false;
    }

    const appPermissions = getEnvParentPermissions(
      orgGraph,
      app.id,
      auth.user.id
    );

    return (
      appPermissions.has("app_manage_blocks") &&
      auth.orgPermissions.has("org_manage_block_groups")
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const id = uuid(),
      appBlockGroup: Api.Db.AppBlockGroup = {
        type: "appBlockGroup",
        id,
        ...graphKey(auth.org.id, "appBlockGroup", id),
        ...pick(["appId", "blockGroupId", "orderIndex"], payload),
        createdAt: now,
        updatedAt: now,
      };

    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [appBlockGroup.id]: appBlockGroup,
      },
      logTargetIds: [appBlockGroup.appId, appBlockGroup.blockGroupId],
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteAppBlockGroup"],
  Api.Net.ApiResultTypes["DeleteAppBlockGroup"]
>({
  type: Api.ActionType.DELETE_APP_BLOCK_GROUP,
  graphAction: true,
  authenticated: true,
  reorderBlobsIfNeeded: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const appBlockGroup = userGraph[payload.id] as Model.AppBlockGroup,
      app = userGraph[appBlockGroup.appId],
      appRole = getAppRoleForUserOrInvitee(
        userGraph,
        appBlockGroup.appId,
        auth.user.id
      );

    if (
      !appBlockGroup ||
      appBlockGroup.type != "appBlockGroup" ||
      !app ||
      !appRole
    ) {
      return false;
    }

    return (
      auth.orgPermissions.has("org_manage_block_groups") ||
      (auth.orgPermissions.has("blocks_manage_connections_permitted") &&
        getAppPermissions(orgGraph, appRole.id).has("app_manage_blocks"))
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const appBlockGroup = orgGraph[payload.id] as Model.AppBlockGroup;
    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(orgGraph, [payload.id], now),
      logTargetIds: [appBlockGroup.appId, appBlockGroup.blockGroupId],
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
    };
  },
});

apiAction<
  Api.Action.RequestActions["CreateAppGroupBlock"],
  Api.Net.ApiResultTypes["CreateAppGroupBlock"]
>({
  type: Api.ActionType.CREATE_APP_GROUP_BLOCK,
  graphAction: true,
  authenticated: true,
  reorderBlobsIfNeeded: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const [appGroup, block] = R.props(
        [payload.appGroupId, payload.blockId],
        userGraph
      ),
      existingAppGroupBlock = graphTypes(orgGraph).appGroupBlocks.filter(
        R.eqBy(R.pick(["appGroupId", "blockId"]), payload as any)
      )[0];

    if (
      !appGroup ||
      appGroup.type != "group" ||
      appGroup.objectType != "app" ||
      !block ||
      block.type != "block" ||
      existingAppGroupBlock
    ) {
      return false;
    }

    return auth.orgPermissions.has("org_manage_app_groups");
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const id = uuid(),
      appGroupBlock: Api.Db.AppGroupBlock = {
        type: "appGroupBlock",
        id,
        ...graphKey(auth.org.id, "appGroupBlock", id),
        ...pick(["appGroupId", "blockId", "orderIndex"], payload),
        createdAt: now,
        updatedAt: now,
      };

    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [appGroupBlock.id]: appGroupBlock,
      },
      logTargetIds: [appGroupBlock.appGroupId, appGroupBlock.blockId],
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteAppGroupBlock"],
  Api.Net.ApiResultTypes["DeleteAppGroupBlock"]
>({
  type: Api.ActionType.DELETE_APP_GROUP_BLOCK,
  graphAction: true,
  authenticated: true,
  reorderBlobsIfNeeded: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const appGroupBlock = userGraph[payload.id] as Model.AppGroupBlock,
      appGroup = userGraph[appGroupBlock.appGroupId] as Model.Group,
      block = userGraph[appGroupBlock.blockId] as Model.Block;

    if (
      !appGroupBlock ||
      appGroupBlock.type != "appGroupBlock" ||
      !appGroup ||
      !block
    ) {
      return false;
    }

    return (
      auth.orgPermissions.has("org_manage_app_groups") &&
      auth.orgPermissions.has("blocks_manage_connections_permitted")
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const appGroupBlock = orgGraph[payload.id] as Model.AppGroupBlock;
    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(orgGraph, [payload.id], now),
      logTargetIds: [appGroupBlock.appGroupId, appGroupBlock.blockId],
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
    };
  },
});

apiAction<
  Api.Action.RequestActions["CreateAppGroupBlockGroup"],
  Api.Net.ApiResultTypes["CreateAppGroupBlockGroup"]
>({
  type: Api.ActionType.CREATE_APP_GROUP_BLOCK_GROUP,
  graphAction: true,
  authenticated: true,
  reorderBlobsIfNeeded: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const [appGroup, blockGroup] = R.props(
        [payload.appGroupId, payload.blockGroupId],
        userGraph
      ),
      existingAppGroupBlockGroup = graphTypes(
        orgGraph
      ).appGroupBlockGroups.filter(
        R.eqBy(R.pick(["appGroupId", "blockGroupId"]), payload as any)
      )[0];

    if (
      !appGroup ||
      appGroup.type != "group" ||
      appGroup.objectType != "app" ||
      !blockGroup ||
      blockGroup.type != "group" ||
      blockGroup.objectType != "block" ||
      existingAppGroupBlockGroup
    ) {
      return false;
    }

    return (
      auth.orgPermissions.has("org_manage_app_groups") &&
      auth.orgPermissions.has("org_manage_block_groups")
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const id = uuid(),
      appGroupBlockGroup: Api.Db.AppGroupBlockGroup = {
        type: "appGroupBlockGroup",
        id,
        ...graphKey(auth.org.id, "appGroupBlockGroup", id),
        ...pick(["appGroupId", "blockGroupId", "orderIndex"], payload),
        createdAt: now,
        updatedAt: now,
      };

    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [appGroupBlockGroup.id]: appGroupBlockGroup,
      },
      logTargetIds: [
        appGroupBlockGroup.appGroupId,
        appGroupBlockGroup.blockGroupId,
      ],
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
    };
  },
});

apiAction<
  Api.Action.RequestActions["DeleteAppGroupBlockGroup"],
  Api.Net.ApiResultTypes["DeleteAppGroupBlockGroup"]
>({
  type: Api.ActionType.DELETE_APP_GROUP_BLOCK_GROUP,
  graphAction: true,
  authenticated: true,
  reorderBlobsIfNeeded: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const appGroupBlockGroup = userGraph[
        payload.id
      ] as Model.AppGroupBlockGroup,
      appGroup = userGraph[appGroupBlockGroup.appGroupId] as Model.Group,
      blockGroup = userGraph[appGroupBlockGroup.blockGroupId] as Model.Group;
    if (
      !appGroupBlockGroup ||
      appGroupBlockGroup.type != "appGroupBlockGroup" ||
      !appGroup ||
      !blockGroup
    ) {
      return false;
    }

    return (
      auth.orgPermissions.has("org_manage_app_groups") &&
      auth.orgPermissions.has("org_manage_block_groups")
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const appGroupBlockGroup = orgGraph[payload.id] as Model.AppGroupBlockGroup;

    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(orgGraph, [payload.id], now),
      logTargetIds: [
        appGroupBlockGroup.appGroupId,
        appGroupBlockGroup.blockGroupId,
      ],
      // TODO: narrow down group scopes
      orgAccessChangeScope: "all",
      encryptedKeysScope: "all",
    };
  },
});

apiAction<
  Api.Action.RequestActions["ReorderAppBlockGroups"],
  Api.Net.ApiResultTypes["ReorderAppBlockGroups"]
>({
  type: Api.ActionType.REORDER_APP_BLOCK_GROUPS,
  graphAction: true,
  authenticated: true,
  reorderBlobsIfNeeded: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const app = userGraph[payload.appId],
      appRole = getAppRoleForUserOrInvitee(userGraph, app.id, auth.user.id),
      blockGroupIds = (getAppBlockGroupsByAppId(orgGraph)[app.id] ?? []).map(
        R.prop("blockGroupId")
      );

    if (!app || !appRole || blockGroupIds.length < 2) {
      return false;
    }

    return (
      (auth.orgPermissions.has("org_manage_block_groups") ||
        (auth.orgPermissions.has("blocks_manage_connections_permitted") &&
          getAppPermissions(orgGraph, appRole.id).has("app_manage_blocks"))) &&
      R.equals(
        R.sortBy(R.identity, Object.keys(payload.order)),
        R.sortBy(R.identity, blockGroupIds)
      )
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const updatedGraph = produce(orgGraph, (draft) => {
      for (let blockGroupId in payload.order) {
        const draftAppBlockGroup =
          getAppBlockGroupsByComposite(draft)[
            [payload.appId, blockGroupId].join("|")
          ];

        draftAppBlockGroup!.orderIndex = payload.order[blockGroupId];
      }
    });

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      logTargetIds: [payload.appId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["ReorderAppGroupBlocks"],
  Api.Net.ApiResultTypes["ReorderAppGroupBlocks"]
>({
  type: Api.ActionType.REORDER_APP_GROUP_BLOCKS,
  graphAction: true,
  authenticated: true,
  reorderBlobsIfNeeded: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const appGroup = userGraph[payload.appGroupId],
      blockIds = (
        getAppGroupBlocksByAppGroupId(orgGraph)[payload.appGroupId] ?? []
      ).map(R.prop("blockId"));

    if (!appGroup || blockIds.length < 2) {
      return false;
    }

    return (
      auth.orgPermissions.has("org_manage_app_groups") &&
      R.equals(
        R.sortBy(R.identity, Object.keys(payload.order)),
        R.sortBy(R.identity, blockIds)
      )
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const updatedGraph = produce(orgGraph, (draft) => {
      for (let blockId in payload.order) {
        const draftAppBlockGroup =
          getAppGroupBlocksByComposite(draft)[
            [payload.appGroupId, blockId].join("|")
          ];

        draftAppBlockGroup!.orderIndex = payload.order[blockId];
      }
    });

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      logTargetIds: [payload.appGroupId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["ReorderAppGroupBlockGroups"],
  Api.Net.ApiResultTypes["ReorderAppGroupBlockGroups"]
>({
  type: Api.ActionType.REORDER_APP_GROUP_BLOCK_GROUPS,
  graphAction: true,
  authenticated: true,
  reorderBlobsIfNeeded: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const appGroup = userGraph[payload.appGroupId],
      blockGroupIds = (
        getAppGroupBlockGroupsByAppGroupId(orgGraph)[payload.appGroupId] ?? []
      ).map(R.prop("blockGroupId"));

    if (!appGroup || blockGroupIds.length < 2) {
      return false;
    }

    return (
      auth.orgPermissions.has("org_manage_app_groups") &&
      auth.orgPermissions.has("org_manage_block_groups") &&
      R.equals(
        R.sortBy(R.identity, Object.keys(payload.order)),
        R.sortBy(R.identity, blockGroupIds)
      )
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const updatedGraph = produce(orgGraph, (draft) => {
      for (let blockGroupId in payload.order) {
        const draftAppGroupBlockGroup =
          getAppGroupBlockGroupsByComposite(draft)[
            [payload.appGroupId, blockGroupId].join("|")
          ];

        draftAppGroupBlockGroup!.orderIndex = payload.order[blockGroupId];
      }
    });

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      logTargetIds: [payload.appGroupId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["ReorderGroupMemberships"],
  Api.Net.ApiResultTypes["ReorderGroupMemberships"]
>({
  type: Api.ActionType.REORDER_GROUP_MEMBERSHIPS,
  graphAction: true,
  authenticated: true,
  reorderBlobsIfNeeded: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    const blockGroup = userGraph[payload.blockGroupId] as Model.Group,
      blockIds = (
        getGroupMembershipsByGroupId(orgGraph)[blockGroup.id] ?? []
      ).map(R.prop("objectId"));

    if (
      !blockGroup ||
      blockGroup.objectType != "block" ||
      blockIds.length < 2
    ) {
      return false;
    }

    return (
      auth.orgPermissions.has("org_manage_block_groups") &&
      R.equals(
        R.sortBy(R.identity, Object.keys(payload.order)),
        R.sortBy(R.identity, blockIds)
      )
    );
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const updatedGraph = produce(orgGraph, (draft) => {
      for (let blockId in payload.order) {
        const draftMembership =
          getGroupMembershipsByComposite(draft)[
            [payload.blockGroupId, blockId].join("|")
          ];

        draftMembership!.orderIndex = payload.order[blockId];
      }
    });
    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      logTargetIds: [payload.blockGroupId],
    };
  },
});

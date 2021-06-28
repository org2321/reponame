import { pick } from "@core/lib/utils/object";
import { apiAction } from "../handler";
import { Api, Rbac } from "@core/types";
import * as R from "ramda";
import {
  graphTypes,
  getOrphanedLocalKeyIdsForUser,
  getGroupMembershipsByObjectId,
  getActiveRecoveryKeysByUserId,
  getOrgPermissions,
  getCurrentEncryptedKeys,
  deleteGraphObjects,
  authz,
  getActiveOrExpiredInvitesByInvitedByUserId,
  getActiveOrExpiredDeviceGrantsByGrantedByUserId,
} from "@core/lib/graph";
import { getOrgGraph, deleteUser } from "../graph";
import { getDeleteEncryptedKeysTransactionItems } from "../blob";
import { getDb } from "../db";
import { scimCandidateDbKey } from "../models/provisioning";

apiAction<
  Api.Action.RequestActions["UpdateOrgSettings"],
  Api.Net.ApiResultTypes["UpdateOrgSettings"]
>({
  type: Api.ActionType.UPDATE_ORG_SETTINGS,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (action, orgGraph, userGraph, auth) =>
    authz.canUpdateOrgSettings(userGraph, auth.user.id),
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const settings = payload;

    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [auth.org.id]: { ...auth.org, settings },
      },
      logTargetIds: [],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RenameOrg"],
  Api.Net.ApiResultTypes["RenameOrg"]
>({
  type: Api.ActionType.RENAME_ORG,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (action, orgGraph, userGraph, auth) =>
    authz.canRenameOrg(userGraph, auth.user.id),
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [auth.org.id]: {
          ...auth.org,
          name: payload.name,
        },
      },
      logTargetIds: [],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RenameUser"],
  Api.Net.ApiResultTypes["RenameUser"]
>({
  type: Api.ActionType.RENAME_USER,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload: { id } }, orgGraph, userGraph, auth) =>
    authz.canRenameUser(userGraph, auth.user.id, id),
  graphHandler: async (
    { payload: { id, firstName, lastName } },
    orgGraph,
    auth,
    now
  ) => {
    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [id]: { ...orgGraph[id], firstName, lastName },
      },
      logTargetIds: [id],
    };
  },
});

apiAction<
  Api.Action.RequestActions["UpdateUserRole"],
  Api.Net.ApiResultTypes["UpdateUserRole"]
>({
  type: Api.ActionType.UPDATE_USER_ROLE,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (
    { payload: { id, orgRoleId } },
    orgGraph,
    userGraph,
    auth
  ) => authz.canUpdateUserRole(userGraph, auth.user.id, id, orgRoleId),
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const target = orgGraph[payload.id] as Api.Db.OrgUser | Api.Db.CliUser,
      userId = target.id,
      oldOrgRole = orgGraph[target.orgRoleId] as Api.Db.OrgRole,
      newOrgRole = orgGraph[payload.orgRoleId] as Api.Db.OrgRole,
      byType = graphTypes(orgGraph),
      settingAutoAppRole =
        !oldOrgRole.autoAppRoleId && newOrgRole.autoAppRoleId;

    let updatedGraph = {
        ...orgGraph,
        [target.id]: {
          ...target,
          orgRoleId: payload.orgRoleId,
          orgRoleUpdatedAt: now,
          updatedAt: now,
        },
      },
      toDeleteIds: string[] = [];

    if (settingAutoAppRole) {
      const appUserGrants = byType.appUserGrants.filter(
          R.propEq("userId", userId)
        ),
        groupMemberships =
          getGroupMembershipsByObjectId(orgGraph)[userId] ?? [],
        appGroupUsers = byType.appGroupUsers.filter(R.propEq("userId", userId));

      toDeleteIds = [
        ...appUserGrants.map(R.prop("id")),
        ...groupMemberships.map(R.prop("id")),
        ...appGroupUsers.map(R.prop("id")),
      ];
    }

    const orphanedLocalKeyIds = getOrphanedLocalKeyIdsForUser(
        updatedGraph,
        auth.user.id
      ),
      orphanedLocalKeyIdsSet = new Set(orphanedLocalKeyIds),
      generatedEnvkeys = byType.generatedEnvkeys.filter(({ keyableParentId }) =>
        orphanedLocalKeyIdsSet.has(keyableParentId)
      );

    toDeleteIds = [
      ...toDeleteIds,
      ...orphanedLocalKeyIds,
      ...generatedEnvkeys.map(R.prop("id")),
    ];

    if (
      getOrgPermissions(orgGraph, oldOrgRole.id).has(
        "org_generate_recovery_key"
      ) &&
      !getOrgPermissions(orgGraph, newOrgRole.id).has(
        "org_generate_recovery_key"
      )
    ) {
      const recoveryKey = getActiveRecoveryKeysByUserId(orgGraph)[userId];
      if (recoveryKey) {
        toDeleteIds.push(recoveryKey.id);
      }
    }

    if (toDeleteIds.length > 0) {
      updatedGraph = deleteGraphObjects(updatedGraph, toDeleteIds, now);
    }

    const scope: Rbac.OrgAccessScope = {
      userIds: new Set([userId]),
      envParentIds: "all",
      keyableParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [userId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RemoveFromOrg"],
  Api.Net.ApiResultTypes["RemoveFromOrg"]
>({
  type: Api.ActionType.REMOVE_FROM_ORG,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload: { id } }, orgGraph, userGraph, auth) =>
    authz.canRemoveFromOrg(userGraph, auth.user.id, id),
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const target = orgGraph[payload.id] as Api.Db.OrgUser,
      userId = target.id,
      candidate = target.scim
        ? await getDb<Api.Db.ScimUserCandidate>(
            scimCandidateDbKey({
              orgId: auth.org.id,
              providerId: target.scim.providerId,
              userCandidateId: target.scim.candidateId,
            })
          )
        : undefined;

    const pendingOrExpiredInviterInvites =
        getActiveOrExpiredInvitesByInvitedByUserId(orgGraph)[userId] ?? [],
      pendingOrExpiredGranterDeviceGrants =
        getActiveOrExpiredDeviceGrantsByGrantedByUserId(orgGraph)[userId] ?? [],
      pendingOrgUserIds = pendingOrExpiredInviterInvites
        .map(R.prop("inviteeId"))
        .concat(pendingOrExpiredGranterDeviceGrants.map(R.prop("granteeId")))
        .filter((inviteeId) => {
          const invitee = orgGraph[inviteeId] as Api.Db.OrgUser;
          return !invitee.inviteAcceptedAt;
        });

    const scope: Rbac.OrgAccessScope = {
      userIds: new Set([userId, ...pendingOrgUserIds]),
      envParentIds: "all",
      keyableParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: deleteUser(orgGraph, userId, auth, now),
      transactionItems: {
        softDeleteScopes: [
          {
            pkey: [auth.org.id, "tokens"].join("|"),
            scope: userId,
          },
        ],
        puts: candidate
          ? [
              {
                ...candidate,
                orgUserId: undefined,
              } as Api.Db.ScimUserCandidate,
            ]
          : undefined,
      },
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [userId],
    };
  },
  clearSockets: (auth, action) => [
    { orgId: auth.org.id, userId: action.payload.id },
  ],
});

apiAction<
  Api.Action.RequestActions["DeleteOrg"],
  Api.Net.ApiResultTypes["DeleteOrg"]
>({
  type: Api.ActionType.DELETE_ORG,
  graphAction: false,
  authenticated: true,
  broadcastOrgSocket: true,
  authorizer: async (action, auth) => {
    return auth.orgPermissions.has("org_delete");
  },
  handler: async (action, auth, now, requestParams, transactionConn) => {
    const orgGraph = await getOrgGraph(auth.org.id, {
        transactionConn,
        lockType: "FOR UPDATE",
      }),
      keySet = getCurrentEncryptedKeys(orgGraph, "all", now),
      { hardDeleteKeys, hardDeleteEncryptedKeyParams } =
        await getDeleteEncryptedKeysTransactionItems(auth, orgGraph, keySet);

    return {
      type: "handlerResult",
      response: {
        type: "success",
      },
      transactionItems: {
        hardDeleteKeys,
        softDeleteKeys: [pick(["pkey", "skey"], auth.org)],
        hardDeleteEncryptedKeyParams,
        transactionItems: {
          hardDeleteEncryptedBlobParams: [{ orgId: auth.org.id }],
        },
      },
      logTargetIds: [],
    };
  },
  clearSockets: (auth, action) => [{ orgId: auth.org.id }],
});

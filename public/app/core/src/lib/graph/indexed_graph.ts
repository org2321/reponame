import { Graph, Rbac, Model, Blob } from "../../types";
import * as R from "ramda";
import memoize from "../../lib/utils/memoize";
import { graphTypes } from "./base";

export const environmentCompositeId = (environment: Model.Environment) =>
    [
      environment.environmentRoleId,
      environment.isSub && environment.subName.toLowerCase(),
    ]
      .filter(Boolean)
      .join("|"),
  getOrgUsersByOrgRoleId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("orgRoleId"),
        graphTypes(graph).orgUsers
      ) as Graph.MaybeGrouped<Model.OrgUser>
  ),
  getCliUsersByOrgRoleId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("orgRoleId"),
        graphTypes(graph).cliUsers
      ) as Graph.MaybeGrouped<Model.CliUser>
  ),
  getOrgRolesByAutoAppRoleId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.propOr(undefined, "autoAppRoleId"),
        graphTypes(graph).orgRoles
      ) as Graph.MaybeGrouped<Rbac.OrgRole>
  ),
  getOrgRolesByExtendsId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.propOr(undefined, "extendsOrgRoleId"),
        graphTypes(graph).orgRoles
      ) as Graph.MaybeGrouped<Rbac.OrgRole>
  ),
  getAppRolesByExtendsId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.propOr(undefined, "extendsAppRoleId"),
        graphTypes(graph).appRoles
      ) as Graph.MaybeGrouped<Rbac.AppRole>
  ),
  getOrgUserDevicesByUserId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("userId"),
        graphTypes(graph).orgUserDevices
      ) as Graph.MaybeGrouped<Model.OrgUserDevice>
  ),
  getActiveOrgUserDevicesByUserId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("userId"),
        graphTypes(graph).orgUserDevices.filter(
          ({ deactivatedAt, deletedAt }) => !deletedAt && !deactivatedAt
        )
      ) as Graph.MaybeGrouped<Model.OrgUserDevice>
  ),
  getActiveInvites = memoize((graph: Graph.Graph, now: number) =>
    graphTypes(graph).invites.filter(
      ({ acceptedAt, expiresAt }) => !acceptedAt && expiresAt > now
    )
  ),
  getActiveOrgUsers = memoize((graph: Graph.Graph) =>
    graphTypes(graph).orgUsers.filter(
      ({ isCreator, deactivatedAt, deletedAt, inviteAcceptedAt }) =>
        !deletedAt && !deactivatedAt && (inviteAcceptedAt || isCreator)
    )
  ),
  getActiveOrInvitedOrgUsers = memoize((graph: Graph.Graph) =>
    graphTypes(graph).orgUsers.filter(
      ({ deactivatedAt, deletedAt }) => !deletedAt && !deactivatedAt
    )
  ),
  getActiveCliUsers = memoize((graph: Graph.Graph) =>
    graphTypes(graph).cliUsers.filter(
      ({ deactivatedAt, deletedAt }) => !deletedAt && !deactivatedAt
    )
  ),
  getActiveOrExpiredInvites = memoize((graph: Graph.Graph) =>
    graphTypes(graph).invites.filter(({ acceptedAt }) => !acceptedAt)
  ),
  getActiveDeviceGrants = memoize((graph: Graph.Graph, now: number) =>
    graphTypes(graph).deviceGrants.filter(
      ({ acceptedAt, expiresAt }) => !acceptedAt && expiresAt > now
    )
  ),
  getExpiredDeviceGrants = memoize((graph: Graph.Graph, now: number) =>
    graphTypes(graph).deviceGrants.filter(
      ({ acceptedAt, expiresAt }) => !acceptedAt && now > expiresAt
    )
  ),
  getActiveOrExpiredDeviceGrants = memoize((graph: Graph.Graph) =>
    graphTypes(graph).deviceGrants.filter(({ acceptedAt }) => !acceptedAt)
  ),
  getActiveInvitesByInviteeId = memoize(
    (graph: Graph.Graph, now: number) =>
      R.groupBy(
        R.prop("inviteeId"),
        getActiveInvites(graph, now)
      ) as Graph.MaybeGrouped<Model.Invite>
  ),
  getActiveOrExpiredInvitesByInviteeId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("inviteeId"),
        getActiveOrExpiredInvites(graph)
      ) as Graph.MaybeGrouped<Model.Invite>
  ),
  getActiveDeviceGrantsByGranteeId = memoize(
    (graph: Graph.Graph, now: number) =>
      R.groupBy(
        R.prop("granteeId"),
        getActiveDeviceGrants(graph, now)
      ) as Graph.MaybeGrouped<Model.DeviceGrant>
  ),
  getExpiredDeviceGrantsByGranteeId = memoize(
    (graph: Graph.Graph, now: number) =>
      R.groupBy(
        R.prop("granteeId"),
        getExpiredDeviceGrants(graph, now)
      ) as Graph.MaybeGrouped<Model.DeviceGrant>
  ),
  getActiveOrExpiredDeviceGrantsByGranteeId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("granteeId"),
        getActiveOrExpiredDeviceGrants(graph)
      ) as Graph.MaybeGrouped<Model.DeviceGrant>
  ),
  getActiveInvitesByInvitedByUserId = memoize(
    (graph: Graph.Graph, now: number) =>
      R.groupBy(
        R.prop("invitedByUserId"),
        getActiveInvites(graph, now)
      ) as Graph.MaybeGrouped<Model.Invite>
  ),
  getActiveOrExpiredInvitesByInvitedByUserId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("invitedByUserId"),
        getActiveOrExpiredInvites(graph)
      ) as Graph.MaybeGrouped<Model.Invite>
  ),
  getActiveDeviceGrantsByGrantedByUserId = memoize(
    (graph: Graph.Graph, now: number) =>
      R.groupBy(
        R.prop("grantedByUserId"),
        getActiveDeviceGrants(graph, now)
      ) as Graph.MaybeGrouped<Model.DeviceGrant>
  ),
  getActiveOrExpiredDeviceGrantsByGrantedByUserId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("grantedByUserId"),
        getActiveOrExpiredDeviceGrants(graph)
      ) as Graph.MaybeGrouped<Model.DeviceGrant>
  ),
  getActiveRecoveryKeys = memoize((graph: Graph.Graph) =>
    graphTypes(graph).recoveryKeys.filter(({ redeemedAt }) => !redeemedAt)
  ),
  getActiveRecoveryKeysByUserId = memoize(
    (graph: Graph.Graph) =>
      R.indexBy(
        R.prop("userId"),
        getActiveRecoveryKeys(graph)
      ) as Graph.MaybeIndexed<Model.RecoveryKey>
  ),
  getAppUserGrantsByUserId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("userId"),
        graphTypes(graph).appUserGrants
      ) as Graph.MaybeGrouped<Model.AppUserGrant>
  ),
  getAppUserGrantsByComposite = memoize(
    (graph: Graph.Graph) =>
      R.indexBy(
        R.pipe(R.props(["userId", "appId"]), R.join("|")),
        graphTypes(graph).appUserGrants
      ) as Graph.MaybeIndexed<Model.AppUserGrant>
  ),
  getAppUserGrantsByAppRoleId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("appRoleId"),
        graphTypes(graph).appUserGrants
      ) as Graph.MaybeGrouped<Model.AppUserGrant>
  ),
  getAppRoleEnvironmentRolesByAppRoleId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("appRoleId"),
        graphTypes(graph).appRoleEnvironmentRoles
      ) as Graph.Grouped<Rbac.AppRoleEnvironmentRole>
  ),
  getAppRoleEnvironmentRolesByEnvironmentRoleId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("environmentRoleId"),
        graphTypes(graph).appRoleEnvironmentRoles
      ) as Graph.Grouped<Rbac.AppRoleEnvironmentRole>
  ),
  getAppRoleEnvironmentRolesByComposite = memoize(
    (graph: Graph.Graph) =>
      R.indexBy(
        R.pipe(R.props(["appRoleId", "environmentRoleId"]), R.join("|")),
        graphTypes(graph).appRoleEnvironmentRoles
      ) as Graph.Indexed<Rbac.AppRoleEnvironmentRole>
  ),
  getAppBlocksByBlockId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("blockId"),
        R.sortBy(R.prop("orderIndex"), graphTypes(graph).appBlocks)
      ) as Graph.MaybeGrouped<Model.AppBlock>
  ),
  getAppBlocksByAppId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("appId"),
        graphTypes(graph).appBlocks
      ) as Graph.MaybeGrouped<Model.AppBlock>
  ),
  getAppBlocksByComposite = memoize(
    (graph: Graph.Graph) =>
      R.indexBy(
        R.pipe(R.props(["appId", "blockId"]), R.join("|")),
        graphTypes(graph).appBlocks
      ) as Graph.MaybeIndexed<Model.AppBlock>
  ),
  getEnvironmentsByEnvParentId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("envParentId"),
        graphTypes(graph).environments
      ) as Graph.MaybeGrouped<Model.Environment>
  ),
  getEnvironmentsByRoleId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("environmentRoleId"),
        graphTypes(graph).environments
      ) as Graph.MaybeGrouped<Model.Environment>
  ),
  getSubEnvironmentsByParentEnvironmentId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("parentEnvironmentId"),
        graphTypes(graph).environments.filter(
          R.prop("isSub")
        ) as (Model.Environment & { parentEnvironmentId: string })[]
      ) as Graph.MaybeGrouped<Model.Environment>
  ),
  getLocalKeysByEnvironmentId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("environmentId"),
        graphTypes(graph).localKeys
      ) as Graph.MaybeGrouped<Model.LocalKey>
  ),
  getLocalKeysByUserId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("userId"),
        graphTypes(graph).localKeys
      ) as Graph.MaybeGrouped<Model.LocalKey>
  ),
  getLocalKeysByEnvironmentComposite = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.pipe(R.props(["environmentId", "userId"]), R.join("|")),
        graphTypes(graph).localKeys
      ) as Graph.MaybeGrouped<Model.LocalKey>
  ),
  getLocalKeysByLocalsComposite = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.pipe(R.props(["appId", "userId"]), R.join("|")),
        graphTypes(graph).localKeys
      ) as Graph.MaybeGrouped<Model.LocalKey>
  ),
  getServersByEnvironmentId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("environmentId"),
        graphTypes(graph).servers
      ) as Graph.MaybeGrouped<Model.Server>
  ),
  getIncludedAppRolesByAppId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("appId"),
        graphTypes(graph).includedAppRoles
      ) as Graph.Grouped<Model.IncludedAppRole>
  ),
  getIncludedAppRolesByAppRoleId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("appRoleId"),
        graphTypes(graph).includedAppRoles
      ) as Graph.MaybeGrouped<Model.IncludedAppRole>
  ),
  getIncludedAppRolesByComposite = memoize(
    (graph: Graph.Graph) =>
      R.indexBy(
        R.pipe(R.props(["appRoleId", "appId"]), R.join("|")),
        graphTypes(graph).includedAppRoles
      ) as Graph.Indexed<Model.IncludedAppRole>
  ),
  getActiveGeneratedEnvkeysByKeyableParentId = memoize(
    (graph: Graph.Graph) =>
      R.indexBy(
        R.prop("keyableParentId"),
        graphTypes(graph).generatedEnvkeys.filter(({ deletedAt }) => !deletedAt)
      ) as Graph.MaybeIndexed<Model.GeneratedEnvkey>
  ),
  getGroupsByObjectType = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("objectType"),
        graphTypes(graph).groups
      ) as Graph.MaybeGrouped<Model.Group>
  ),
  getGroupMembershipsByObjectId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("objectId"),
        graphTypes(graph).groupMemberships
      ) as Graph.MaybeGrouped<Model.GroupMembership>
  ),
  getGroupMembershipsByGroupId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("groupId"),
        graphTypes(graph).groupMemberships
      ) as Graph.MaybeGrouped<Model.GroupMembership>
  ),
  getGroupMembershipsByComposite = memoize(
    (graph: Graph.Graph) =>
      R.indexBy(
        R.pipe(R.props(["groupId", "objectId"]), R.join("|")),
        graphTypes(graph).groupMemberships
      ) as Graph.MaybeIndexed<Model.GroupMembership>
  ),
  getAppUserGroupsByAppId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("appId"),
        graphTypes(graph).appUserGroups
      ) as Graph.MaybeGrouped<Model.AppUserGroup>
  ),
  getAppUserGroupsByComposite = memoize(
    (graph: Graph.Graph) =>
      R.indexBy(
        R.pipe(R.props(["appId", "userGroupId"]), R.join("|")),
        graphTypes(graph).appUserGroups
      ) as Graph.MaybeIndexed<Model.AppUserGroup>
  ),
  getAppGroupUserGroupsByComposite = memoize(
    (graph: Graph.Graph) =>
      R.indexBy(
        R.pipe(R.props(["appGroupId", "userGroupId"]), R.join("|")),
        graphTypes(graph).appGroupUserGroups
      ) as Graph.MaybeIndexed<Model.AppGroupUserGroup>
  ),
  getAppGroupUserGroupsByAppGroupId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("appGroupId"),
        graphTypes(graph).appGroupUserGroups
      ) as Graph.MaybeGrouped<Model.AppGroupUserGroup>
  ),
  getAppGroupUsersByComposite = memoize(
    (graph: Graph.Graph) =>
      R.indexBy(
        R.pipe(R.props(["appGroupId", "userId"]), R.join("|")),
        graphTypes(graph).appGroupUsers
      ) as Graph.MaybeIndexed<Model.AppGroupUser>
  ),
  getAppBlockGroupsByAppId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("appId"),
        graphTypes(graph).appBlockGroups
      ) as Graph.MaybeGrouped<Model.AppBlockGroup>
  ),
  getAppBlockGroupsByComposite = memoize(
    (graph: Graph.Graph) =>
      R.indexBy(
        R.pipe(R.props(["appId", "blockGroupId"]), R.join("|")),
        graphTypes(graph).appBlockGroups
      ) as Graph.MaybeIndexed<Model.AppBlockGroup>
  ),
  getAppGroupBlockGroupsByAppGroupId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("appGroupId"),
        graphTypes(graph).appGroupBlockGroups
      ) as Graph.MaybeGrouped<Model.AppGroupBlockGroup>
  ),
  getAppGroupBlockGroupsByComposite = memoize(
    (graph: Graph.Graph) =>
      R.indexBy(
        R.pipe(R.props(["appGroupId", "blockGroupId"]), R.join("|")),
        graphTypes(graph).appGroupBlockGroups
      ) as Graph.MaybeIndexed<Model.AppGroupBlockGroup>
  ),
  getAppGroupBlocksByAppGroupId = memoize(
    (graph: Graph.Graph) =>
      R.groupBy(
        R.prop("appGroupId"),
        graphTypes(graph).appGroupBlocks
      ) as Graph.MaybeGrouped<Model.AppGroupBlock>
  ),
  getAppGroupBlocksByComposite = memoize(
    (graph: Graph.Graph) =>
      R.indexBy(
        R.pipe(R.props(["appGroupId", "blockId"]), R.join("|")),
        graphTypes(graph).appGroupBlocks
      ) as Graph.MaybeIndexed<Model.AppGroupBlock>
  );

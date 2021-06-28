import { Graph, Rbac, Model, Billing } from "../../types";
import * as R from "ramda";
import memoize from "../utils/memoize";
import { pick } from "../utils/pick";
import pluralize from "pluralize";
import { getEnvironmentName } from "./names";

export const graphObjects = memoize(
  (graph: Graph.Graph) =>
    R.sortBy(
      (o) => ("orderIndex" in o ? o.orderIndex ?? o.createdAt : o.createdAt),
      Object.values(graph)
    ) as Graph.GraphObject[]
);

export const graphTypes = memoize((graph: Graph.Graph) => {
  const grouped = R.groupBy(
    ({ type }) => pluralize(type),
    graphObjects(graph)
  ) as any;

  const byType = (<any>(
    R.map(
      (v) => v || [],
      pick(
        [
          "orgUserDevices",
          "orgUsers",
          "cliUsers",
          "recoveryKeys",
          "deviceGrants",
          "invites",
          "apps",
          "blocks",
          "appUserGrants",
          "appBlocks",
          "groupMemberships",
          "groups",
          "appUserGroups",
          "appGroupUserGroups",
          "appGroupUsers",
          "appGroupBlocks",
          "appBlockGroups",
          "appGroupBlockGroups",
          "servers",
          "localKeys",
          "includedAppRoles",
          "environments",
          "variableGroups",
          "generatedEnvkeys",
          "orgRoles",
          "appRoles",
          "environmentRoles",
          "appRoleEnvironmentRoles",
          "pubkeyRevocationRequests",
          "rootPubkeyReplacements",
          "externalAuthProviders",
          "files",
          "scimProvisioningProviders",
        ],
        grouped
      )
    )
  )) as {
    org: Model.Org;
    license: Billing.License;
    orgUserDevices: Model.OrgUserDevice[];
    orgUsers: Model.OrgUser[];
    cliUsers: Model.CliUser[];
    recoveryKeys: Model.RecoveryKey[];
    deviceGrants: Model.DeviceGrant[];
    invites: Model.Invite[];
    apps: Model.App[];
    blocks: Model.Block[];
    appUserGrants: Model.AppUserGrant[];
    appBlocks: Model.AppBlock[];
    groupMemberships: Model.GroupMembership[];
    groups: Model.Group[];
    appUserGroups: Model.AppUserGroup[];
    appGroupUserGroups: Model.AppGroupUserGroup[];
    appGroupUsers: Model.AppGroupUser[];
    appGroupBlocks: Model.AppGroupBlock[];
    appBlockGroups: Model.AppBlockGroup[];
    appGroupBlockGroups: Model.AppGroupBlockGroup[];
    servers: Model.Server[];
    localKeys: Model.LocalKey[];
    includedAppRoles: Model.IncludedAppRole[];
    environments: Model.Environment[];
    variableGroups: Model.VariableGroup[];
    generatedEnvkeys: Model.GeneratedEnvkey[];
    orgRoles: Rbac.OrgRole[];
    appRoles: Rbac.AppRole[];
    environmentRoles: Rbac.EnvironmentRole[];
    appRoleEnvironmentRoles: Rbac.AppRoleEnvironmentRole[];
    pubkeyRevocationRequests: Model.PubkeyRevocationRequest[];
    rootPubkeyReplacements: Model.RootPubkeyReplacement[];
    externalAuthProviders: Model.ExternalAuthProvider[];
    files: Model.File[];
    scimProvisioningProviders: Model.ScimProvisioningProvider[];
  };

  if (grouped.orgs) {
    byType.org = grouped.orgs[0];
  }

  if (grouped.licenses) {
    byType.license = grouped.licenses[0];
  }

  byType.environments = R.sortBy((environment) => {
    const role = graph[environment.environmentRoleId] as Rbac.EnvironmentRole;

    if (!role) {
      return environment.createdAt;
    }

    if (role.orderIndex) {
      return role.orderIndex;
    }

    const name = getEnvironmentName(graph, environment.id);

    // always put Development, Staging, and Production first if they exist
    // tacking a "3" onto subsequent
    if (!environment.isSub && role.defaultName) {
      const i = ["Development", "Staging", "Production"].indexOf(
        role.defaultName
      );
      return i == -1 ? "3" + name : "0" + i.toString();
    }
    return "3" + name;
  }, byType.environments);

  byType.apps = R.sortBy(R.prop("name"), byType.apps);
  byType.blocks = R.sortBy(R.prop("name"), byType.blocks);
  byType.orgUsers = R.sortBy(R.prop("lastName"), byType.orgUsers);
  byType.cliUsers = R.sortBy(R.prop("name"), byType.cliUsers);

  byType.includedAppRoles = R.sortBy(({ appRoleId, createdAt }) => {
    const appRole = graph[appRoleId] as Rbac.AppRole;
    return appRole?.orderIndex ?? createdAt;
  }, byType.includedAppRoles);

  return byType;
});

export const getActiveGraph = <T extends Graph.Graph = Graph.Graph>(graph: T) =>
  R.filter(
    ({ deletedAt }) => !deletedAt,
    graph as R.Dictionary<Graph.GraphObject>
  ) as T;

export const getOrg = (graph: Graph.Graph) =>
  graphTypes(graph).org as Model.Org;

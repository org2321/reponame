import { Model } from "@core/types";

export const getEnvParentPath = (envParent: Model.EnvParent) =>
  `/${envParent.type}s/${envParent.id}`;

export const getUserPath = (
  userOrDevice: Model.OrgUserDevice | Model.OrgUser | Model.CliUser
) =>
  userOrDevice.type == "orgUserDevice"
    ? `/orgUsers/${userOrDevice.userId}`
    : `/${userOrDevice.type}s/${userOrDevice.id}`;

export const getGroupPath = (group: Model.Group) => `/groups/${group.id}`;

export const getLocalsPath = (
  envParent: Model.EnvParent,
  baseEnvironmentId: string,
  localsUserId: string
) => {
  return `/${envParent.type}s/${
    envParent.id
  }/environments/${baseEnvironmentId}/sub-environments/${[
    envParent.id,
    localsUserId,
  ].join("|")}`;
};

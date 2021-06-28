import { Graph, Rbac, Model } from "../../types";
import moment from "moment";

export const getEnvironmentName = (
  graph: Graph.Graph,
  environmentId: string
) => {
  const environment = graph[environmentId] as Model.Environment | undefined;

  if (environment) {
    const role = graph[environment.environmentRoleId] as Rbac.EnvironmentRole;
    return "subName" in environment ? environment.subName : role.name;
  } else {
    const [, localsUserId] = environmentId.split("|");
    return getUserName(graph, localsUserId, true) + " Locals";
  }
};

export const getUserName = (
  graph: Graph.Graph,
  userOrDeviceId: string,
  firstInitialOnly?: true
) => {
  const userOrDevice = graph[userOrDeviceId] as
    | Model.OrgUser
    | Model.CliUser
    | Model.OrgUserDevice;
  const user =
    userOrDevice.type == "orgUserDevice"
      ? (graph[userOrDevice.userId] as Model.OrgUser)
      : userOrDevice;
  if (user.type == "orgUser") {
    return [
      firstInitialOnly ? user.firstName[0] + "." : user.firstName,
      user.lastName,
    ].join(" ");
  }

  return user.name;
};

export const getObjectName = (graph: Graph.Graph, id: string): string => {
  const object = graph[id] as Graph.GraphObject | undefined;

  if (!object) {
    return "unknown";
  }

  switch (object.type) {
    case "org":
    case "orgUserDevice":
    case "app":
    case "block":
    case "server":
    case "localKey":
    case "orgRole":
    case "appRole":
    case "environmentRole":
    case "variableGroup":
    case "group":
      return object.name;

    case "license":
      return (
        object.plan +
        (object.provisional ? " (provisional)" : "") +
        ` - valid until ${moment.utc(object.expiresAt).format("lll")} UTC`
      );

    case "orgUser":
    case "cliUser":
      return getUserName(graph, id);

    case "recoveryKey":
      return `${getUserName(graph, object.userId)} Recovery Key - ${moment
        .utc(object.createdAt)
        .format("lll")} UTC`;

    case "environment":
      let environmentName: string;

      if (object.isSub) {
        environmentName =
          getEnvironmentName(graph, object.parentEnvironmentId) +
          " > " +
          object.subName;
      } else {
        environmentName = getEnvironmentName(graph, id);
      }

      return environmentName;

    case "generatedEnvkey":
      return `${object.envkeyShort}…`;

    case "externalAuthProvider":
      return object.provider == "saml"
        ? `SAML Directory - ${object.nickname ?? object.id}`
        : `External Auth Provider - ${object.id}`;

    case "file":
      return object.path;

    case "scimProvisioningProvider":
      return `SCIM Connection - ${object.nickname ?? object.endpointBaseUrl}`;

    // The following aren't printed out anywhere yet, but could be in the future
    case "deviceGrant":
      return ``;

    case "invite":
      return ``;

    case "appUserGrant":
      return ``;

    case "appBlock":
      return ``;

    case "groupMembership":
      return ``;

    case "appUserGroup":
      return ``;

    case "appGroupUserGroup":
      return ``;

    case "appGroupUser":
      return ``;

    case "appGroupBlock":
      return ``;

    case "appBlockGroup":
      return ``;

    case "appGroupBlockGroup":
      return ``;

    case "includedAppRole":
      return ``;

    case "appRoleEnvironmentRole":
      return ``;

    case "pubkeyRevocationRequest":
      return ``;

    case "rootPubkeyReplacement":
      return ``;
  }
};

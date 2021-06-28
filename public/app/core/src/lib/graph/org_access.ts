import { Graph, Rbac, Model } from "../../types";
import * as R from "ramda";
import { setToObject } from "../../lib/utils/object";
import { graphTypes } from "./base";
import {
  getOrgPermissions,
  getEnvParentPermissions,
  getEnvironmentPermissions,
} from "./permissions";
import { getConnectedBlockEnvironmentsForApp } from "./app_blocks";
import { getScoped } from "./scoped";

export const getOrgAccessSet = (
  graph: Graph.Graph,
  scope: Rbac.OrgAccessScope
) => {
  // const now = Date.now();

  let res: Rbac.OrgAccessSet = {};

  const {
    scopeUsers,
    scopeDevices,
    scopeApps,
    scopeEnvironments,
    scopeGeneratedEnvkeys,
  } = getScoped(graph, scope);

  for (let user of scopeUsers) {
    const orgPermissions = getOrgPermissions(graph, user.orgRoleId);

    res = R.assocPath(
      ["orgPermissions", "users", user.id],
      setToObject(orgPermissions),
      res
    );

    for (let { id: appId } of scopeApps) {
      const appPermissions = getEnvParentPermissions(graph, appId, user.id);
      res = R.assocPath(
        ["appPermissions", appId, "users", user.id],
        setToObject(appPermissions),
        res
      );
    }

    for (let { id: environmentId } of scopeEnvironments) {
      const environmentPermissions = getEnvironmentPermissions(
        graph,
        environmentId,
        user.id
      );

      // logWithElapsed("got user environment permissions", now);

      res = R.assocPath(
        ["environments", environmentId, "users", user.id],
        setToObject(environmentPermissions),
        res
      );
    }
  }

  // logWithElapsed("users", now);

  for (let { userId, id: deviceId } of scopeDevices) {
    const orgUser = graph[userId] as Model.OrgUser,
      orgPermissions = getOrgPermissions(graph, orgUser.orgRoleId);

    res = R.assocPath(
      ["orgPermissions", "devices", deviceId],
      setToObject(orgPermissions),
      res
    );

    for (let { id: appId } of scopeApps) {
      const appPermissions = getEnvParentPermissions(graph, appId, userId);
      res = R.assocPath(
        ["appPermissions", appId, "devices", deviceId],
        setToObject(appPermissions),
        res
      );
    }

    for (let { id: environmentId } of scopeEnvironments) {
      const environmentPermissions = getEnvironmentPermissions(
        graph,
        environmentId,
        userId
      );
      res = R.assocPath(
        ["environments", environmentId, "devices", deviceId],
        setToObject(environmentPermissions),
        res
      );
    }
  }

  // logWithElapsed("devices", now);

  for (let {
    id: generatedEnvkeyId,
    appId,
    keyableParentId,
    keyableParentType,
  } of scopeGeneratedEnvkeys) {
    const keyableParent = graph[keyableParentId] as Model.KeyableParent,
      environment = graph[keyableParent.environmentId] as Model.Environment;

    res = R.assocPath(
      [
        "environments",
        environment.id,
        keyableParentType + "s",
        keyableParentId,
      ],
      generatedEnvkeyId,
      res
    );

    if (environment.isSub) {
      res = R.assocPath(
        [
          "environments",
          environment.parentEnvironmentId,
          keyableParentType + "s",
          keyableParentId,
        ],
        generatedEnvkeyId,
        res
      );
    }

    const connectedBlockEnvironments = getConnectedBlockEnvironmentsForApp(
      graph,
      appId,
      undefined,
      environment.id
    );
    for (let blockEnvironment of connectedBlockEnvironments) {
      if (
        scope != "all" &&
        scope.envParentIds &&
        scope.envParentIds != "all" &&
        !scope.envParentIds.has(blockEnvironment.envParentId)
      ) {
        continue;
      }

      if (
        scope != "all" &&
        scope.environmentIds &&
        scope.environmentIds != "all" &&
        !scope.environmentIds.has(blockEnvironment.id)
      ) {
        continue;
      }

      res = R.assocPath(
        [
          "environments",
          blockEnvironment.id,
          keyableParentType + "s",
          keyableParentId,
        ],
        generatedEnvkeyId,
        res
      );

      if (blockEnvironment.isSub) {
        res = R.assocPath(
          [
            "environments",
            blockEnvironment.parentEnvironmentId,
            keyableParentType + "s",
            keyableParentId,
          ],
          generatedEnvkeyId,
          res
        );
      }
    }
  }

  // logWithElapsed("envkeys", now);

  return res;
};

import React, { useState, useMemo, useEffect } from "react";
import { OrgComponent } from "@ui_types";
import { Client, Model, Api, Rbac } from "@core/types";
import { Link } from "react-router-dom";
import * as g from "@core/lib/graph";
import * as R from "ramda";
import { twitterShortTs } from "@core/lib/utils/date";
import { getEnvParentPath } from "@ui_lib/paths";
import * as styles from "@styles";

const getBlockEnvkeysComponent = (
  keyableParentType: Model.KeyableParent["type"]
) => {
  const BlockEnvkeys: OrgComponent<{ blockId: string }> = (props) => {
    const { graph, graphUpdatedAt } = props.core;
    const currentUserId = props.ui.loadedAccountId!;
    const currentAccount = props.core.orgUserAccounts[currentUserId]!;
    const blockId = props.routeParams.blockId;
    const now = props.ui.now;

    const {
      baseEnvironments,
      connectedApps,
      keyableParentsByEnvironmentId,
      generatedEnvkeysByKeyableParentId,
      subEnvironmentsByParentEnvironmentId,
    } = useMemo(() => {
      let baseEnvironments = g.authz.getVisibleBaseEnvironments(
        graph,
        currentUserId,
        blockId
      );

      baseEnvironments = baseEnvironments.filter(({ environmentRoleId }) => {
        const role = graph[environmentRoleId] as Rbac.EnvironmentRole;
        return keyableParentType == "localKey"
          ? role.hasLocalKeys
          : role.hasServers;
      });

      const keyableParentsByEnvironmentId =
        keyableParentType == "localKey"
          ? R.mapObjIndexed(
              (localKeys) =>
                localKeys
                  ? localKeys.filter(R.propEq("userId", currentUserId))
                  : localKeys,
              g.getLocalKeysByEnvironmentId(graph)
            )
          : g.getServersByEnvironmentId(graph);

      const connectedApps = g.getConnectedAppsForBlock(graph, blockId);

      return {
        baseEnvironments,
        connectedApps,
        keyableParentsByEnvironmentId,
        generatedEnvkeysByKeyableParentId: g.getActiveGeneratedEnvkeysByKeyableParentId(
          graph
        ),
        subEnvironmentsByParentEnvironmentId: g.getSubEnvironmentsByParentEnvironmentId(
          graph
        ),
      };
    }, [graphUpdatedAt, currentUserId, blockId]);

    const showEnvironmentLabel = !(
      keyableParentType == "localKey" && baseEnvironments.length == 1
    );

    const renderEnvkey = (keyableParent: Model.KeyableParent) => {
      const generated = generatedEnvkeysByKeyableParentId[keyableParent.id];
      if (generated) {
        const generatedBy = graph[generated.creatorId] as
          | Model.OrgUser
          | Model.CliUser;

        return (
          <div>
            <label>{generated.envkeyShort}...</label>
            <label>
              Generated by{" "}
              {generatedBy.id == currentUserId
                ? "you"
                : g.getUserName(graph, generatedBy.id)}{" "}
              {twitterShortTs(generated.createdAt, now)}
            </label>
          </div>
        );
      } else {
        return <div>No key generated.</div>;
      }
    };

    const renderKeyableParent = (keyableParent: Model.KeyableParent) => {
      return (
        <div>
          <label>{keyableParent.name}</label>
          {renderEnvkey(keyableParent)}
        </div>
      );
    };

    const renderConnectedAppEnvironment = (
      app: Model.App,
      blockEnvironmentId: string
    ) => {
      const [connectedAppEnvironment] = g.getConnectedAppEnvironmentsForBlock(
        graph,
        blockId,
        blockEnvironmentId,
        app.id
      );

      if (!connectedAppEnvironment) {
        return;
      }

      const keyableParents = (keyableParentsByEnvironmentId[
        connectedAppEnvironment.id
      ] ?? []) as Model.KeyableParent[];

      const subEnvironments =
        subEnvironmentsByParentEnvironmentId[connectedAppEnvironment.id] ?? [];

      return (
        <div>
          {keyableParents.length > 0 || subEnvironments.length > 0 ? (
            <h4>
              <Link to={props.orgRoute(getEnvParentPath(app)) + "/envkeys"}>
                {app.name}
              </Link>
            </h4>
          ) : (
            ""
          )}

          {keyableParents.length > 0 ? (
            <div>{keyableParents.map(renderKeyableParent)}</div>
          ) : (
            ""
          )}
          {keyableParentType == "server" && subEnvironments.length > 0 ? (
            <div>
              <label>Sub-Environments</label>
              {subEnvironments.map(renderSubEnvironmentSection)}
            </div>
          ) : (
            ""
          )}
        </div>
      );
    };

    const renderEnvironmentSection = (environment: Model.Environment) => {
      return (
        <div>
          {showEnvironmentLabel ? (
            <h3>{g.getEnvironmentName(graph, environment.id)}</h3>
          ) : (
            ""
          )}
          {connectedApps.map((app) =>
            renderConnectedAppEnvironment(app, environment.id)
          )}
        </div>
      );
    };

    const renderSubEnvironmentSection = (subEnvironment: Model.Environment) => {
      const keyableParents = (keyableParentsByEnvironmentId[
        subEnvironment.id
      ] ?? []) as Model.KeyableParent[];

      return (
        <div>
          <div>
            <label>{g.getEnvironmentName(graph, subEnvironment.id)}</label>
          </div>

          <div>{keyableParents.map(renderKeyableParent)}</div>
        </div>
      );
    };

    return (
      <div className={styles.ManageEnvkeys}>
        <div>{baseEnvironments.map(renderEnvironmentSection)}</div>
      </div>
    );
  };

  return BlockEnvkeys;
};

export const BlockLocalEnvkeys = getBlockEnvkeysComponent("localKey");
export const BlockServerEnvkeys = getBlockEnvkeysComponent("server");

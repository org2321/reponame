import React, { useState, useMemo, useEffect } from "react";
import { Client, Model, Rbac } from "@core/types";
import * as g from "@core/lib/graph";
import { OrgComponent } from "@ui_types";
import * as ui from "@ui";
import * as styles from "@styles";
import { SvgImage } from "@images";

const getAppAddUsersComponent = (userType: "orgUser" | "cliUser") => {
  const AppAddUsers: OrgComponent<{ appId: string }> = (props) => {
    const appId = props.routeParams.appId;
    const graph = props.core.graph;
    const graphUpdatedAt = props.core.graphUpdatedAt;
    const currentUserId = props.ui.loadedAccountId!;
    const now = props.ui.now;

    const {
      grantableAppRoles,
      grantableUsersByAppRoleId,
      existingAppRoleByUserId,
    } = useMemo(() => {
      const grantableAppRoles = g.authz.getAccessGrantableAppRoles(
        graph,
        currentUserId,
        appId
      );

      const grantableUsers =
        userType == "orgUser"
          ? g.authz.getAccessGrantableOrgUsersForApp(
              graph,
              currentUserId,
              appId,
              now
            )
          : g.authz.getAccessGrantableCliUsersForApp(
              graph,
              currentUserId,
              appId
            );

      const existingAppRoleByUserId: Record<
        string,
        Rbac.AppRole | undefined
      > = {};
      const grantableUserIdsByAppRoleId: Record<string, Set<string>> = {};
      const grantableUsersByAppRoleId: Record<
        string,
        (Model.OrgUser | Model.CliUser)[]
      > = {};

      for (let grantableUser of grantableUsers) {
        const existingAppRole = g.getAppRoleForUserOrInvitee(
          graph,
          appId,
          grantableUser.id
        );
        existingAppRoleByUserId[grantableUser.id] = existingAppRole;

        const appRoles = g.authz.getAccessGrantableAppRolesForUser(
          graph,
          currentUserId,
          appId,
          grantableUser.id
        );
        for (let { id: appRoleId } of appRoles) {
          if (!grantableUserIdsByAppRoleId[appRoleId]) {
            grantableUserIdsByAppRoleId[appRoleId] = new Set<string>();
            grantableUsersByAppRoleId[appRoleId] = [];
          }
          const userIds = grantableUserIdsByAppRoleId[appRoleId];
          if (!userIds.has(grantableUser.id)) {
            userIds.add(grantableUser.id);
            grantableUsersByAppRoleId[appRoleId].push(grantableUser);
          }
        }
      }

      return {
        grantableAppRoles,
        grantableUsersByAppRoleId,
        existingAppRoleByUserId,
      };
    }, [
      graphUpdatedAt,
      currentUserId,
      appId,
      userType == "orgUser" ? now : null,
    ]);

    const [selectedAppRoleId, setSelectedAppRoleId] = useState(
      grantableAppRoles[grantableAppRoles.length - 1].id
    );

    const grantableUsers = useMemo(
      () => grantableUsersByAppRoleId[selectedAppRoleId] ?? [],
      [grantableUsersByAppRoleId, selectedAppRoleId]
    );

    const renderAppRoleSelect = () => {
      if (grantableAppRoles.length == 0) {
        return;
      }

      return (
        <div className="select">
          <select
            value={selectedAppRoleId}
            onChange={(e) => setSelectedAppRoleId(e.target.value)}
          >
            {grantableAppRoles.map((appRole) => (
              <option value={appRole.id}>{appRole.name}</option>
            ))}
          </select>
          <SvgImage type="down-caret" />
        </div>
      );
    };

    return (
      <div className={styles.ManageCollaborators}>
        <div className="field app-role">
          <label>Add With App Role</label>
          {renderAppRoleSelect()}
        </div>
        <div className="field">
          <label>{userType == "orgUser" ? "People" : "CLI Keys"} To Add</label>
          <ui.MultiSelect
            title="Collaborator"
            winHeight={props.winHeight}
            emptyText="No collaborators can be added with this App Role. Try a different role."
            items={grantableUsers.map((user) => {
              const name = g.getUserName(graph, user.id);
              const existingRole = existingAppRoleByUserId[user.id];
              return {
                id: user.id,
                searchText: name,
                label: (
                  <label>
                    {name}{" "}
                    {existingRole ? (
                      <span className="small">
                        Current Role: <strong>{existingRole.name}</strong>
                      </span>
                    ) : (
                      ""
                    )}
                  </label>
                ),
              };
            })}
            onSubmit={(ids) => {
              props.dispatch({
                type: Client.ActionType.GRANT_APPS_ACCESS,
                payload: ids.map((userId) => ({
                  appId,
                  userId,
                  appRoleId: selectedAppRoleId,
                })),
              });
              props.history.push(
                props.location.pathname.replace(/\/add.+$/, "/list")
              );
            }}
          />
        </div>
      </div>
    );
  };

  return AppAddUsers;
};

export const AppAddOrgUsers = getAppAddUsersComponent("orgUser");
export const AppAddCliUsers = getAppAddUsersComponent("cliUser");

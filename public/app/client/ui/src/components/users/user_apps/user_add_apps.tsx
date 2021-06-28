import React, { useState, useMemo } from "react";
import { Client, Model, Rbac } from "@core/types";
import * as g from "@core/lib/graph";
import { OrgComponent } from "@ui_types";
import * as styles from "@styles";
import { SvgImage } from "@images";
import * as ui from "@ui";
import { Link } from "react-router-dom";

export const UserAddApps: OrgComponent<{ userId: string }> = (props) => {
  const userId = props.routeParams.userId;
  const graph = props.core.graph;
  const user = graph[userId] as Model.OrgUser | Model.CliUser;
  const graphUpdatedAt = props.core.graphUpdatedAt;
  const currentUserId = props.ui.loadedAccountId!;
  const now = props.ui.now;

  const {
    grantableAppRoles,
    grantableAppsByAppRoleId,
    existingAppRolesByAppId,
  } = useMemo(() => {
    const grantableApps = g.authz.getAccessGrantableAppsForUser(
      graph,
      currentUserId,
      userId
    );

    const grantableAppsByAppRoleId: Record<string, Model.App[]> = {};
    const grantableAppRoleIds = new Set<string>();
    const grantableAppRoles: Rbac.AppRole[] = [];
    const existingAppRolesByAppId: Record<
      string,
      Rbac.AppRole | undefined
    > = {};

    for (let app of grantableApps) {
      const roles = g.authz.getAccessGrantableAppRolesForUser(
        graph,
        currentUserId,
        app.id,
        userId
      );
      for (let role of roles) {
        if (!grantableAppRoleIds.has(role.id)) {
          grantableAppRoleIds.add(role.id);
          grantableAppRoles.push(role);
        }
        if (!grantableAppsByAppRoleId[role.id]) {
          grantableAppsByAppRoleId[role.id] = [];
        }
        grantableAppsByAppRoleId[role.id].push(app);
      }
      const existingAppRole = g.getAppRoleForUserOrInvitee(
        graph,
        app.id,
        userId
      );
      existingAppRolesByAppId[app.id] = existingAppRole;
    }

    return {
      grantableAppRoles,
      grantableAppsByAppRoleId,
      existingAppRolesByAppId,
    };
  }, [graphUpdatedAt, currentUserId, userId, now]);

  const [selectedAppRoleId, setSelectedAppRoleId] = useState(
    grantableAppRoles[grantableAppRoles.length - 1].id
  );

  const grantableApps = useMemo(
    () => grantableAppsByAppRoleId[selectedAppRoleId] ?? [],
    [grantableAppsByAppRoleId, selectedAppRoleId]
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
    <div className={styles.ManageApps}>
      <div>
        <Link to={props.match.url.replace(/\/add-apps$/, "/apps")}>Back</Link>
      </div>
      <div className="field app-role">
        <label>Add With App Role</label>
        {renderAppRoleSelect()}
      </div>
      <div className="field">
        <label>Apps To Add</label>

        <ui.MultiSelect
          title="App"
          winHeight={props.winHeight}
          emptyText="No apps can be added with this App Role. Try a different role."
          items={grantableApps.map((app) => {
            const existingRole = existingAppRolesByAppId[app.id];
            return {
              id: app.id,
              searchText: app.name,
              label: (
                <label>
                  {app.name}{" "}
                  {existingRole ? (
                    <span className="small">
                      Current Role: {existingRole.name}
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
              payload: ids.map((appId) => ({
                appId,
                userId,
                appRoleId: selectedAppRoleId,
              })),
            });
            props.history.push(
              props.location.pathname.replace(/\/add-apps$/, "/apps")
            );
          }}
        />
      </div>
    </div>
  );
};

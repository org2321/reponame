import React, { useEffect } from "react";
import { OrgComponent } from "@ui_types";
import { Model, Rbac } from "@core/types";
import { AppTabs } from "./app_tabs";
import { fetchEnvsIfNeeded } from "@ui_lib/envs";
import * as g from "@core/lib/graph";
import * as styles from "@styles";
import { SvgImage } from "@images";

let initialAppRole: Rbac.AppRole | undefined;
let initialAppPermissionsJson: string | undefined;
let initialOrgRoleId: string | undefined;
let initialOrgPermissionsJson: string | undefined;

export const AppContainer: OrgComponent<{ appId: string }> = (props) => {
  const { graph, graphUpdatedAt } = props.core;
  const app = graph[props.routeParams.appId] as Model.App;
  const currentUserId = props.ui.loadedAccountId!;
  const currentUser = graph[currentUserId] as Model.OrgUser;
  const appRole = g.getAppRoleForUserOrInvitee(graph, app.id, currentUserId);
  const orgRole = graph[currentUser.orgRoleId] as Rbac.OrgRole;
  const appPermissionsJson = JSON.stringify(
    app
      ? Array.from(
          g.getEnvParentPermissions(graph, app.id, currentUserId)
        ).sort()
      : []
  );
  const orgPermissionsJson = JSON.stringify(
    Array.from(g.getOrgPermissions(graph, orgRole.id)).sort()
  );

  useEffect(() => {
    if (app) {
      fetchEnvsIfNeeded(props, app.id);
    }
  }, [app?.id, graphUpdatedAt]);

  useEffect(() => {
    initialOrgRoleId = orgRole.id;
    initialAppRole = appRole;
    initialAppPermissionsJson = appPermissionsJson;
    initialOrgPermissionsJson = orgPermissionsJson;
  }, [app?.id]);

  useEffect(() => {
    if (
      initialOrgRoleId == orgRole.id &&
      orgPermissionsJson == initialOrgPermissionsJson &&
      appRole &&
      appRole.id != initialAppRole?.id
    ) {
      alert(
        "Your role in this app has been changed. Your role is now: " +
          appRole.name
      );
    } else if (
      initialOrgRoleId == orgRole.id &&
      orgPermissionsJson == initialOrgPermissionsJson &&
      initialAppPermissionsJson != appPermissionsJson
    ) {
      alert("Your permissions for this app have been updated.");
    }

    initialOrgRoleId = orgRole.id;
    initialAppRole = appRole;
    initialAppPermissionsJson = appPermissionsJson;
    initialOrgPermissionsJson = orgPermissionsJson;
  }, [appRole?.id, appPermissionsJson, orgRole.id, orgPermissionsJson]);

  return (
    <div className={styles.SelectedObjectContainer}>
      <header className={styles.SelectedObjectHeader}>
        <h1>
          <span>
            App
            <SvgImage type="right-caret" />
          </span>
          <label>{app.name}</label>
        </h1>

        <AppTabs {...props} appId={app.id} />
      </header>
    </div>
  );
};

import React from "react";
import { OrgComponent } from "@ui_types";
import * as ui from "@ui";
import * as g from "@core/lib/graph";
import * as styles from "@styles";

export const AppEnvkeysContainer: OrgComponent<{ appId: string }> = (props) => {
  const appId = props.routeParams.appId;
  const currentUserId = props.ui.loadedAccountId!;
  const { graph } = props.core;

  const canManageLocalKeys = g.authz.hasAppPermission(
    graph,
    currentUserId,
    appId,
    "app_manage_local_keys"
  );

  const canManageServers = g.authz.hasAppPermission(
    graph,
    currentUserId,
    appId,
    "app_manage_servers"
  );

  return (
    <div className={styles.ManageEnvkeys}>
      {canManageLocalKeys
        ? [
            <h3>
              Local Development <strong>Keys</strong>
            </h3>,
            <ui.AppLocalEnvkeys {...props} />,
          ]
        : ""}

      {canManageServers
        ? [
            <h3>
              Server <strong>Keys</strong>
            </h3>,
            <ui.AppServerEnvkeys {...props} />,
          ]
        : ""}
    </div>
  );
};

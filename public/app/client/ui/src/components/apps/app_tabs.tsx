import React, { useMemo, useCallback } from "react";
import { OrgComponent } from "@ui_types";
import { Model } from "@core/types";
import * as g from "@core/lib/graph";
import * as ui from "@ui";
import * as styles from "@styles";

export const AppTabs: OrgComponent<{}, { appId: string }> = (props) => {
  const app = props.core.graph[props.appId] as Model.App;
  const { graph, graphUpdatedAt } = props.core;
  const currentUserId = props.ui.loadedAccountId!;

  const [
    canReadVersions,
    canListOrgUserCollaborators,
    canListEnvkeys,
    canListCliKeys,
    canReadLogs,
    canManageSettings,
  ] = useMemo(() => {
    return [
      g.authz.canReadAppVersions(graph, currentUserId, app.id),

      g.authz.canListAppCollaborators(graph, currentUserId, app.id, "orgUser"),

      g.authz.hasAnyAppPermissions(graph, currentUserId, app.id, [
        "app_manage_local_keys",
        "app_manage_servers",
      ]),

      g.authz.canListAppCollaborators(graph, currentUserId, app.id, "cliUser"),

      g.authz.hasAppPermission(graph, currentUserId, app.id, "app_read_logs"),

      g.authz.hasAppPermission(
        graph,
        currentUserId,
        app.id,
        "app_manage_settings"
      ),
    ];
  }, [graphUpdatedAt, currentUserId, app.id]);

  const basePathTest = useCallback(() => {
    return app && props.location.pathname.endsWith(app.id);
  }, [props.location.pathname, app.id]);

  return (
    <ui.Tabs
      {...props}
      redirectFromBasePath={true}
      basePathTest={basePathTest}
      className={styles.SelectedObjectTabs}
      tabs={[
        {
          label: "Environments",
          path: "/environments",
          permitted: () => true,
        },
        {
          label: "ENVKEYs",
          path: "/envkeys",
          permitted: () => canListEnvkeys,
        },
        {
          label: "Collaborators",
          path: "/collaborators",
          permitted: () => canListOrgUserCollaborators,
        },
        {
          label: "Versions",
          path: `/versions`,
          permitted: () => canReadVersions,
        },
        {
          label: "Logs",
          path: `/logs`,
          permitted: () => canReadLogs,
        },
        {
          label: "CLI Keys",
          path: "/cli-keys",
          permitted: () => canListCliKeys,
        },
        {
          label: "Settings",
          path: "/settings",
          permitted: () => canManageSettings,
        },
      ]}
    />
  );
};

import React, { useMemo, useCallback } from "react";
import { OrgComponent } from "@ui_types";
import * as ui from "@ui";
import * as g from "@core/lib/graph";
import * as styles from "@styles";

export const MyOrgTabs: OrgComponent = (props) => {
  const graph = props.core.graph;
  const currentUserId = props.ui.loadedAccountId!;

  const [
    canManageSettings,
    canManageAuth,
    canGenRecoveryKey,
    canReadLogs,
    canManageBilling,
  ] = useMemo(
    () => [
      g.authz.hasOrgPermission(graph, currentUserId, "org_manage_settings"),
      g.authz.hasOrgPermission(
        graph,
        currentUserId,
        "org_manage_auth_settings"
      ),
      g.authz.hasOrgPermission(
        graph,
        currentUserId,
        "org_generate_recovery_key"
      ),
      g.authz.hasAnyOrgPermissions(graph, currentUserId, [
        "org_read_logs",
        "host_read_logs",
      ]),
      g.authz.hasOrgPermission(graph, currentUserId, "org_manage_billing"),
    ],
    [props.core.graphUpdatedAt, currentUserId]
  );

  const basePathTest = useCallback(() => {
    return props.location.pathname.endsWith("/my-org");
  }, [props.location.pathname]);

  return (
    <ui.Tabs
      {...props}
      redirectFromBasePath={true}
      basePathTest={basePathTest}
      className={styles.SelectedObjectTabs}
      tabs={[
        {
          label: "Settings",
          path: "/settings",
          permitted: () => canManageSettings,
        },
        {
          label: "SSO",
          path: "/sso",
          permitted: () => canManageAuth,
        },
        {
          label: "Billing",
          path: "/billing",
          permitted: () => canManageBilling,
        },
        {
          label: "Logs",
          path: "/logs",
          permitted: () => canReadLogs,
        },
        {
          label: "Recovery",
          path: "/recovery-key",
          permitted: () => canGenRecoveryKey,
        },
      ]}
    />
  );
};

import React, { useMemo, useCallback } from "react";
import { OrgComponent } from "@ui_types";
import { Model } from "@core/types";
import * as ui from "@ui";
import * as g from "@core/lib/graph";
import * as styles from "@styles";

export const UserTabs: OrgComponent<{}, { userId: string }> = (props) => {
  const { graph, graphUpdatedAt } = props.core;
  const user = graph[props.userId] as Model.OrgUser | Model.CliUser;
  const currentUserId = props.ui.loadedAccountId!;
  const now = props.ui.now;

  const [
    canManageSettings,
    canListApps,
    canListBlocks,
    canReadLogs,
  ] = useMemo(
    () => [
      user.type == "orgUser"
        ? g.authz.canManageOrgUser(graph, currentUserId, user.id)
        : g.authz.canManageCliUser(graph, currentUserId, user.id),
      g.authz.canListAppsForUser(graph, currentUserId, user.id),
      g.authz.canListBlocksForUser(graph, currentUserId, user.id),
      g.authz.hasOrgPermission(graph, currentUserId, "org_read_logs"),
    ],
    [graphUpdatedAt, currentUserId, user.id]
  );

  const canManageDevices = useMemo(
    () =>
      g.authz.canManageAnyUserDevicesOrGrants(
        graph,
        currentUserId,
        user.id,
        now
      ),
    [graphUpdatedAt, currentUserId, user.id, now]
  );

  const basePathTest = useCallback(() => {
    return props.location.pathname.endsWith(user.id);
  }, [props.location.pathname, user.id]);

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
          label: "Devices",
          path: "/devices",
          permitted: () => canManageDevices,
        },
        {
          label: "Apps",
          path: "/apps",
          permitted: () => canListApps,
        },
        {
          path: "/add-apps",
          hidden: true,
          permitted: () => true,
        },

        {
          label: "Blocks",
          path: "/blocks",
          permitted: () => canListBlocks,
        },
        {
          label: "Logs",
          path: "/logs",
          permitted: () => canReadLogs,
        },
      ]}
    />
  );
};

import React, { useMemo, useCallback } from "react";
import { OrgComponent } from "@ui_types";
import { Model } from "@core/types";
import * as ui from "@ui";
import * as g from "@core/lib/graph";
import * as styles from "@styles";

export const BlockTabs: OrgComponent<{}, { blockId: string }> = (props) => {
  const { graph, graphUpdatedAt } = props.core;
  const block = graph[props.blockId] as Model.Block;
  const currentUserId = props.ui.loadedAccountId!;

  const [
    canReadVersions,
    canListOrgUserCollaborators,
    canListEnvkeys,
    canListCliKeys,
    canReadLogs,
    canManageSettings,
  ] = useMemo(() => {
    const blockPermissions = g.getConnectedAppPermissionsUnionForBlock(
      graph,
      block.id,
      currentUserId
    );

    return [
      g.authz.canReadBlockVersions(graph, currentUserId, block.id),

      g.authz.canListBlockCollaborators(
        graph,
        currentUserId,
        block.id,
        "orgUser"
      ),

      g.authz.hasOrgPermission(graph, currentUserId, "blocks_read_all") ||
        blockPermissions.has("app_manage_local_keys") ||
        blockPermissions.has("app_manage_servers"),

      g.authz.canListBlockCollaborators(
        graph,
        currentUserId,
        block.id,
        "cliUser"
      ),

      g.authz.hasOrgPermission(graph, currentUserId, "org_read_logs"),

      g.authz.hasOrgPermission(graph, currentUserId, "blocks_manage_settings"),
    ];
  }, [graphUpdatedAt, currentUserId, block.id]);

  const basePathTest = useCallback(() => {
    return block && props.location.pathname.endsWith(block.id);
  }, [props.location.pathname, block.id]);

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
          label: "Apps",
          path: "/apps",
          permitted: () => true,
        },
        {
          path: "/add-apps",
          permitted: () => true,
          hidden: true,
        },
        {
          label: "Versions",
          path: "/versions",
          permitted: () => canReadVersions,
        },
        {
          label: "Logs",
          path: "/logs",
          permitted: () => canReadLogs,
        },

        {
          label: "Collaborators",
          path: "/collaborators",
          permitted: () => canListOrgUserCollaborators,
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

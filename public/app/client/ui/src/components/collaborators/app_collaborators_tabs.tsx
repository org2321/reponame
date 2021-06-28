import React, { useMemo, useCallback } from "react";
import { OrgComponent } from "@ui_types";
import { Model } from "@core/types";
import * as g from "@core/lib/graph";
import * as ui from "@ui";
import * as R from "ramda";
import * as styles from "@styles";

export const AppCollaboratorsTabs: OrgComponent<{}, { appId: string }> = (
  props
) => {
  const app = props.core.graph[props.appId] as Model.App;
  const { graph, graphUpdatedAt } = props.core;
  const currentUserId = props.ui.loadedAccountId!;

  const canManageTeams = useMemo(() => {
    return g.authz.canManageUserGroups(graph, currentUserId);
  }, [graphUpdatedAt, currentUserId, app.id]);

  const basePathTest = useCallback(() => {
    return props.location.pathname.endsWith("/collaborators");
  }, [props.location.pathname]);

  return (
    <ui.Tabs
      {...props}
      className={styles.SelectedObjectSubTabs}
      redirectFromBasePath={true}
      basePathTest={basePathTest}
      tabs={[
        {
          label: "People",
          path: "/list",
          permitted: () => true,
        },
        {
          label: "Teams",
          path: `/teams`,
          permitted: () => canManageTeams,
        },
        {
          path: "/list/add",
          hidden: true,
          permitted: () => true,
        },
      ]}
    />
  );
};

import React, { useMemo, useCallback } from "react";
import { OrgComponent } from "@ui_types";
import { Model } from "@core/types";
import * as g from "@core/lib/graph";
import * as ui from "@ui";
import * as styles from "@styles";

export const AppAddCliUsersTabs: OrgComponent<{}, { appId: string }> = (
  props
) => {
  const app = props.core.graph[props.appId] as Model.App;
  const { graph, graphUpdatedAt } = props.core;
  const currentUserId = props.ui.loadedAccountId!;

  const canCreate = useMemo(() => {
    return g.authz.canCreateCliUserForApp(graph, currentUserId, app.id);
  }, [graphUpdatedAt, currentUserId, app.id]);

  const basePathTest = useCallback(() => {
    return props.location.pathname.endsWith("/add");
  }, [props.location.pathname]);

  return (
    <ui.Tabs
      {...props}
      className={styles.SelectedObjectSubTabs}
      redirectFromBasePath={true}
      basePathTest={basePathTest}
      tabs={[
        {
          label: "Add Existing CLI Keys",
          path: "/existing",
          permitted: () => true,
        },
        {
          label: "Create New CLI Key",
          path: `/new-cli-key`,
          permitted: () => canCreate,
        },
      ]}
    />
  );
};

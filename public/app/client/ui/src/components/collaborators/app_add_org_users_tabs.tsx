import React, { useMemo, useCallback } from "react";
import { OrgComponent } from "@ui_types";
import { Model } from "@core/types";
import * as g from "@core/lib/graph";
import * as ui from "@ui";
import * as R from "ramda";
import * as styles from "@styles";

export const AppAddOrgUsersTabs: OrgComponent<{}, { appId: string }> = (
  props
) => {
  const app = props.core.graph[props.appId] as Model.App;
  const { graph, graphUpdatedAt } = props.core;
  const currentUserId = props.ui.loadedAccountId!;

  const canInvite = useMemo(() => {
    return g.authz.canInviteToApp(graph, currentUserId, app.id);
  }, [graphUpdatedAt, currentUserId, app.id]);

  const basePathTest = useCallback(() => {
    return props.location.pathname.endsWith("/add");
  }, [props.location.pathname]);

  return (
    <ui.Tabs
      {...props}
      className={styles.SelectedObjectSubTabs + " add"}
      redirectFromBasePath={true}
      basePathTest={basePathTest}
      tabs={[
        {
          label: "Add Existing",
          path: "/existing",
          permitted: () => true,
        },
        {
          label: "Invite New",
          path: `/invite-users`,
          permitted: () => canInvite,
        },
      ]}
    />
  );
};

import React, { useMemo } from "react";
import { Client } from "@core/types";
import * as g from "@core/lib/graph";
import { OrgComponent } from "@ui_types";
import * as styles from "@styles";
import * as ui from "@ui";
import { Link } from "react-router-dom";

export const BlockAddApps: OrgComponent<{ blockId: string }> = (props) => {
  const { graph, graphUpdatedAt } = props.core;
  const currentUserId = props.ui.loadedAccountId!;
  const blockId = props.routeParams.blockId;

  const connectableApps = useMemo(() => {
    return g.authz.getConnectableAppsForBlock(graph, currentUserId, blockId);
  }, [graphUpdatedAt, currentUserId, blockId]);

  return (
    <div>
      <Link
        className={styles.SelectedObjectBackLink}
        to={props.match.url.replace(/\/add-apps$/, "/apps")}
      >
        ← Back To Apps
      </Link>
      <div className={styles.ManageApps}>
        <div className="field">
          <label>Apps To Connect</label>

          <ui.MultiSelect
            title="App"
            actionLabel="Connect"
            emptyText="No apps can be connected."
            winHeight={props.winHeight}
            items={connectableApps.map((app) => {
              return {
                id: app.id,
                searchText: app.name,
                label: <label>{app.name}</label>,
              };
            })}
            onSubmit={(ids) => {
              props.dispatch({
                type: Client.ActionType.CONNECT_BLOCKS,
                payload: ids.map((appId, i) => ({
                  blockId,
                  appId,
                  orderIndex: i,
                })),
              });

              props.history.push(
                props.location.pathname.replace(/\/add-apps$/, "/apps")
              );
            }}
          />
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect, useMemo } from "react";
import { OrgComponent } from "@ui_types";
import { Client, Model, Api } from "@core/types";
import * as R from "ramda";
import * as g from "@core/lib/graph";
import { style } from "typestyle";
import { color } from "csx";
import { Link } from "react-router-dom";
import { getEnvParentPath } from "@ui_lib/paths";
import * as styles from "@styles";
import { SvgImage, SmallLoader } from "@images";
import { MIN_ACTION_DELAY_MS } from "@constants";
import { wait } from "@core/lib/utils/wait";

export const BlockApps: OrgComponent<{ blockId: string }> = (props) => {
  const { graph, graphUpdatedAt } = props.core;
  const currentUserId = props.ui.loadedAccountId!;
  const blockId = props.routeParams.blockId;

  const [removingId, setRemovingId] = useState<string>();
  const [awaitingMinDelay, setAwaitingMinDelay] = useState(false);

  const [connectedApps, appIds] = useMemo(() => {
    const apps = g.getConnectedAppsForBlock(graph, blockId);

    return [apps, new Set(apps.map(R.prop("id")))];
  }, [graphUpdatedAt, currentUserId, blockId]);

  useEffect(() => {
    if (removingId && !appIds.has(removingId)) {
      setRemovingId(undefined);
    }
  }, [appIds]);

  const remove = (app: Model.App) => {
    const appBlock =
      g.getAppBlocksByComposite(graph)[[app.id, blockId].join("|")];
    if (!appBlock || removingId) {
      return;
    }
    setRemovingId(app.id);
    setAwaitingMinDelay(true);
    wait(MIN_ACTION_DELAY_MS).then(() => setAwaitingMinDelay(false));

    props.dispatch({
      type: Api.ActionType.DISCONNECT_BLOCK,
      payload: {
        id: appBlock.id,
      },
    });
  };

  const renderRemove = (app: Model.App) => {
    if (removingId == app.id) {
      return <SmallLoader />;
    }

    if (
      g.authz.canDisconnectBlock(graph, currentUserId, {
        appId: app.id,
        blockId,
      })
    ) {
      return (
        <span className="delete" onClick={() => remove(app)}>
          <SvgImage type="x" />
          <span>Remove</span>
        </span>
      );
    }
  };

  const renderApp = (app: Model.App) => {
    return (
      <div>
        <div>
          <span className="title">
            <Link to={props.orgRoute(getEnvParentPath(app))}>{app.name}</Link>
          </span>
          <div className={"actions" + (removingId ? " disabled" : "")}>
            {renderRemove(app)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.ManageApps}>
      <div>
        <h3>
          {connectedApps.length} <strong>Connected Apps</strong>
        </h3>

        {g.authz.hasOrgPermission(
          graph,
          currentUserId,
          "blocks_manage_connections_permitted"
        ) &&
        g.authz.getAppsWithAllPermissions(graph, currentUserId, [
          "app_manage_blocks",
        ]).length > 0 ? (
          <div className="buttons">
            <Link
              className="primary"
              to={props.match.url.replace(/\/apps(\/[^\/]*)?$/, "/add-apps")}
            >
              Connect Apps
            </Link>
          </div>
        ) : (
          ""
        )}

        <div className="assoc-list">{connectedApps.map(renderApp)}</div>
      </div>
    </div>
  );
};

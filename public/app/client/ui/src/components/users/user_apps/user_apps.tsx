import React, { useState, useEffect, useMemo } from "react";
import { Model, Api, Rbac } from "@core/types";
import * as R from "ramda";
import * as g from "@core/lib/graph";
import { OrgComponent } from "@ui_types";
import { Link } from "react-router-dom";
import { getEnvParentPath, getGroupPath } from "@ui_lib/paths";
import { style } from "typestyle";
import { twitterShortTs } from "@core/lib/utils/date";
import * as styles from "@styles";
import { AppUserAccessRow } from "../../shared/app_user_access_row";
import { SvgImage, SmallLoader } from "@images";
import { MIN_ACTION_DELAY_MS } from "@constants";
import { wait } from "@core/lib/utils/wait";

export const UserApps: OrgComponent<{ userId: string }> = (props) => {
  const userId = props.routeParams.userId;
  const graph = props.core.graph;
  const user = graph[userId] as Model.OrgUser | Model.CliUser;
  const orgRole = graph[user.orgRoleId] as Rbac.OrgRole;
  const graphUpdatedAt = props.core.graphUpdatedAt;
  const currentUserId = props.ui.loadedAccountId!;
  const now = props.ui.now;

  const [removingId, setRemovingId] = useState<string>();
  const [awaitingMinDelay, setAwaitingMinDelay] = useState(false);

  const { appRoleIds, appsByAppRoleId, appIds } = useMemo(() => {
    const apps = g
      .graphTypes(graph)
      .apps.filter((app) =>
        g.getAppRoleForUserOrInvitee(graph, app.id, userId)
      );

    const appsByAppRoleId = R.groupBy(
      (app) => g.getAppRoleForUserOrInvitee(graph, app.id, userId)!.id,
      apps
    );

    return {
      appRoleIds: Object.keys(appsByAppRoleId),
      appsByAppRoleId,
      appIds: new Set(apps.map(R.prop("id"))),
    };
  }, [graphUpdatedAt, currentUserId, userId, now]);

  const numApps = appIds.size;

  useEffect(() => {
    if (removingId && !appIds.has(removingId)) {
      setRemovingId(undefined);
    }
  }, [appIds]);

  const remove = (app: Model.App) => {
    const appUserGrant = g.getAppUserGrantsByComposite(graph)[
      [userId, app.id].join("|")
    ];

    if (!appUserGrant || removingId) {
      return;
    }
    setRemovingId(app.id);
    setAwaitingMinDelay(true);
    wait(MIN_ACTION_DELAY_MS).then(() => setAwaitingMinDelay(false));

    props.dispatch({
      type: Api.ActionType.REMOVE_APP_ACCESS,
      payload: {
        id: appUserGrant.id,
      },
    });
  };

  const renderRemove = (app: Model.App) => {
    if (removingId == app.id) {
      return <SmallLoader />;
    }

    if (
      g.authz.canRemoveAppUserAccess(graph, currentUserId, {
        userId,
        appId: app.id,
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

  const renderAccess = (app: Model.App) => (
    <AppUserAccessRow {...props} appId={app.id} userId={userId} />
  );

  const renderApp = (app: Model.App) => {
    return (
      <div>
        <div>
          <span className="title">
            <Link to={props.orgRoute(getEnvParentPath(app))}>{app.name}</Link>
          </span>
        </div>

        <div>
          {renderAccess(app)}
          <div className={"actions" + (removingId ? " disabled" : "")}>
            {renderRemove(app)}
          </div>
        </div>
      </div>
    );
  };

  const renderAppRoleSection = (appRoleId: string) => {
    const appRole = graph[appRoleId] as Rbac.AppRole;
    const apps = appsByAppRoleId[appRoleId] ?? [];

    if (apps.length > 0) {
      return (
        <div>
          <h4>{appRole.name}</h4>
          <div className="assoc-list">{apps.map(renderApp)}</div>
        </div>
      );
    }
  };

  return (
    <div className={styles.ManageApps}>
      <div>
        <h3>
          {numApps}
          <strong>{numApps == 1 ? " app" : " apps"}</strong>
        </h3>
        {orgRole.autoAppRoleId ? (
          ""
        ) : (
          <div className="buttons">
            <Link
              className="primary"
              to={props.match.url.replace(/\/apps(\/[^\/]*)?$/, "/add-apps")}
            >
              Add Apps
            </Link>
          </div>
        )}

        <div>{appRoleIds.map(renderAppRoleSection)}</div>
      </div>
    </div>
  );
};

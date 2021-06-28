import React, { useState, useEffect, useMemo } from "react";
import { Model, Api, Rbac } from "@core/types";
import * as R from "ramda";
import * as g from "@core/lib/graph";
import { OrgComponent } from "@ui_types";
import { Link } from "react-router-dom";
import { getUserPath, getGroupPath } from "@ui_lib/paths";
import { style } from "typestyle";
import * as styles from "@styles";
import { AppUserAccessRow } from "../shared/app_user_access_row";
import { SvgImage, SmallLoader } from "@images";
import { MIN_ACTION_DELAY_MS } from "@constants";
import { wait } from "@core/lib/utils/wait";

const getAppUsersComponent = (userType: "orgUser" | "cliUser") => {
  const AppUsers: OrgComponent<{ appId: string }> = (props) => {
    const appId = props.routeParams.appId;
    const graph = props.core.graph;
    const graphUpdatedAt = props.core.graphUpdatedAt;
    const currentUserId = props.ui.loadedAccountId!;
    const now = props.ui.now;
    const userTypeLabelLower = { orgUser: "collaborator", cliUser: "CLI Key" }[
      userType
    ];
    const userTypeLabelCapitalized = {
      orgUser: "Collaborator",
      cliUser: "CLI Key",
    }[userType];

    const [removingId, setRemovingId] = useState<string>();

    const { appRoleIds, collaboratorsByAppRoleId, collaboratorIds } =
      useMemo(() => {
        const collaborators = g.authz.getAppCollaborators(
          graph,
          currentUserId,
          appId,
          userType
        );

        return {
          appRoleIds: (g.getIncludedAppRolesByAppId(graph)[appId] ?? []).map(
            R.prop("appRoleId")
          ),
          collaboratorsByAppRoleId: R.groupBy(
            (user) => g.getAppRoleForUserOrInvitee(graph, appId, user.id)!.id,
            collaborators
          ),
          collaboratorIds: new Set(collaborators.map(R.prop("id"))),
        };
      }, [graphUpdatedAt, currentUserId, appId, now]);

    const numCollaborators = collaboratorIds.size;

    useEffect(() => {
      if (removingId && !collaboratorIds.has(removingId)) {
        setRemovingId(undefined);
      }
    }, [collaboratorIds]);

    const remove = (user: Model.OrgUser | Model.CliUser) => {
      const appUserGrant =
        g.getAppUserGrantsByComposite(graph)[[user.id, appId].join("|")];

      if (!appUserGrant || removingId) {
        return;
      }
      setRemovingId(user.id);

      props.dispatch({
        type: Api.ActionType.REMOVE_APP_ACCESS,
        payload: {
          id: appUserGrant.id,
        },
      });
    };

    const renderRemove = (user: Model.OrgUser | Model.CliUser) => {
      if (removingId == user.id) {
        return <SmallLoader />;
      }

      if (
        g.authz.canRemoveAppUserAccess(graph, currentUserId, {
          appId,
          userId: user.id,
        })
      ) {
        return (
          <span className="delete" onClick={() => remove(user)}>
            <SvgImage type="x" />
            <span>Remove</span>
          </span>
        );
      }
    };

    const renderAccess = (user: Model.OrgUser | Model.CliUser) => (
      <AppUserAccessRow {...props} appId={appId} userId={user.id} />
    );

    const renderCollaborator = (user: Model.OrgUser | Model.CliUser) => {
      return (
        <div>
          <div>
            <span className="title">
              <Link to={props.orgRoute(getUserPath(user))}>
                {g.getUserName(graph, user.id)}
              </Link>
            </span>

            {user.type == "orgUser" ? (
              <span className="subtitle">{user.email}</span>
            ) : (
              ""
            )}
          </div>

          <div>
            {renderAccess(user)}
            <div className={"actions" + (removingId ? " disabled" : "")}>
              {renderRemove(user)}
            </div>
          </div>
        </div>
      );
    };

    const renderAppRoleSection = (appRoleId: string) => {
      const appRole = graph[appRoleId] as Rbac.AppRole;
      const collaborators = collaboratorsByAppRoleId[appRoleId] ?? [];

      if (collaborators.length > 0) {
        return (
          <div>
            <h4>{appRole.name}</h4>
            <div className="assoc-list">
              {collaborators.map(renderCollaborator)}
            </div>
          </div>
        );
      }
    };

    return (
      <div className={styles.ManageCollaborators}>
        <div>
          <h3>
            {numCollaborators}{" "}
            <strong>
              {userTypeLabelLower}
              {numCollaborators == 1 ? "" : "s"}
            </strong>
            {numCollaborators == 1 ? ` has ` : ` have `}
            access
          </h3>
          <div className="buttons">
            <Link
              className="primary"
              to={props.match.url.replace(/\/list(\/[^\/]*)?$/, "/list/add")}
            >
              Add {userTypeLabelCapitalized}
            </Link>
          </div>
          <div>{appRoleIds.map(renderAppRoleSection)}</div>
        </div>
      </div>
    );
  };

  return AppUsers;
};

export const AppOrgUsers = getAppUsersComponent("orgUser");
export const AppCliUsers = getAppUsersComponent("cliUser");

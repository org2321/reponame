import React from "react";
import * as g from "@core/lib/graph";
import { Client, Model, Rbac } from "@core/types";
import { twitterShortTs } from "@core/lib/utils/date";
import { Link } from "react-router-dom";
import { OrgComponent } from "@ui_types";
import { getUserPath, getGroupPath } from "@ui_lib/paths";

export const AppUserAccessRow: OrgComponent<
  {},
  {
    userId: string;
    appId: string;
  }
> = (props) => {
  const {
    core: { graph },
    ui: { now },
    userId,
    appId,
  } = props;

  const user = graph[userId] as Model.OrgUser | Model.CliUser;

  const appUserGrant = g.getAppUserGrantsByComposite(graph)[
    [user.id, appId].join("|")
  ];
  const groupAssoc = g.getAppUserGroupAssoc(graph, appId, user.id);

  const orgRole = graph[user.orgRoleId] as Rbac.OrgRole;

  const contents: React.ReactNode[] = [];

  if (user.type == "orgUser") {
    const inviteStatus = g.getInviteStatus(graph, user.id, now);

    if (
      inviteStatus == "pending" ||
      inviteStatus == "expired" ||
      inviteStatus == "failed"
    ) {
      contents.push(<span className="role">Invite {inviteStatus + " "}</span>);
    } else {
      contents.push(
        <span className="role">
          Access {orgRole.autoAppRoleId ? "Auto-Granted" : "Granted"}
        </span>
      );
    }
  } else {
    contents.push(
      <span className="role">
        Access {orgRole.autoAppRoleId ? "Auto-Granted" : "Granted"}
      </span>
    );
  }

  const ts =
    appUserGrant?.createdAt ??
    groupAssoc?.createdAt ??
    user.orgRoleUpdatedAt ??
    ("inviteAcceptedAt" in user ? user.inviteAcceptedAt : undefined) ??
    user.createdAt;

  contents.push(
    <span className="sep">{"●"}</span>,
    <span className="timestamp">{twitterShortTs(ts, now)}</span>
  );

  if (groupAssoc) {
    if (groupAssoc.type == "appGroupUser") {
      const appGroup = graph[groupAssoc.appGroupId] as Model.Group;
      contents.push(
        <span>
          via app group:
          <Link to={props.orgRoute(getGroupPath(appGroup))}>
            {appGroup.name}
          </Link>
        </span>
      );
    } else if (groupAssoc.type == "appUserGroup") {
      const userGroup = graph[groupAssoc.userGroupId] as Model.Group;
      contents.push(
        <span>
          via team:
          <Link to={props.orgRoute(getGroupPath(userGroup))}>
            {userGroup.name}
          </Link>
        </span>
      );
    } else if (groupAssoc.type == "appGroupUserGroup") {
      const appGroup = graph[groupAssoc.appGroupId] as Model.Group;
      const userGroup = graph[groupAssoc.userGroupId] as Model.Group;

      contents.push(
        <span>
          via app group:
          <Link to={props.orgRoute(getGroupPath(appGroup))}>
            {appGroup.name}
          </Link>
          / team:
          <Link to={props.orgRoute(getGroupPath(userGroup))}>
            {userGroup.name}
          </Link>
        </span>
      );
    }
  }

  return <span className="access">{contents}</span>;
};

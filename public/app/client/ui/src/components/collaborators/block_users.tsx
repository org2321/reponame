import React, { useMemo } from "react";
import { Model, Rbac } from "@core/types";
import * as g from "@core/lib/graph";
import { OrgComponent } from "@ui_types";
import { Link } from "react-router-dom";
import { getUserPath } from "@ui_lib/paths";
import { BlockUserAccessRow } from "../shared/block_user_access_row";
import { style } from "typestyle";
import * as styles from "@styles";

const getBlockUsersComponent = (userType: "orgUser" | "cliUser") => {
  const BlockUsers: OrgComponent<{ blockId: string }> = (props) => {
    const blockId = props.routeParams.blockId;
    const graph = props.core.graph;
    const graphUpdatedAt = props.core.graphUpdatedAt;
    const currentUserId = props.ui.loadedAccountId!;
    const now = props.ui.now;
    const userTypeLabelLower = { orgUser: "user", cliUser: "CLI key" }[
      userType
    ];

    const {
      collaborators,
      appConnectionsByUserId,
      canReadAllOrgBlocksByUserId,
    } = useMemo(() => {
      const collaborators = g.authz.getBlockCollaborators(
        graph,
        currentUserId,
        blockId,
        userType
      );

      const canReadAllOrgBlocksByUserId: Record<string, true> = {};
      const appConnectionsByUserId: Record<string, Model.App[]> = {};

      for (let user of collaborators) {
        const canReadAllOrgBlocks = g.authz.hasOrgPermission(
          graph,
          user.id,
          "blocks_read_all"
        );
        if (canReadAllOrgBlocks) {
          canReadAllOrgBlocksByUserId[user.id] = true;
          continue;
        }

        const appConnections =
          g.getAppConnectionsByBlockId(graph, user.id)[blockId] ?? [];
        appConnectionsByUserId[user.id] = appConnections;
      }

      return {
        collaborators,
        appConnectionsByUserId,
        canReadAllOrgBlocksByUserId,
      };
    }, [graphUpdatedAt, currentUserId, blockId]);

    const renderAccessRow = (user: Model.OrgUser | Model.CliUser) => {
      return (
        <BlockUserAccessRow
          {...props}
          connectedApps={appConnectionsByUserId[user.id] ?? []}
          canReadAllOrgBlocks={canReadAllOrgBlocksByUserId[user.id]}
          orgRole={graph[user.orgRoleId] as Rbac.OrgRole}
        />
      );
    };

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

          <div>{renderAccessRow(user)}</div>
        </div>
      );
    };

    return (
      <div className={styles.ManageCollaborators}>
        <div>
          <h3>
            {collaborators.length}{" "}
            <strong>
              {userTypeLabelLower}
              {collaborators.length == 1 ? "" : "s"}
            </strong>
            {collaborators.length == 1 ? ` has ` : ` have `}
            access
          </h3>
          <div className="assoc-list">
            {collaborators.map(renderCollaborator)}
          </div>
        </div>
      </div>
    );
  };

  return BlockUsers;
};

export const BlockOrgUsers = getBlockUsersComponent("orgUser");
export const BlockCliUsers = getBlockUsersComponent("cliUser");

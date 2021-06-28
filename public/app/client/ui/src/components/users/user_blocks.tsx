import React, { useMemo } from "react";
import { Model, Api, Rbac } from "@core/types";
import * as R from "ramda";
import * as g from "@core/lib/graph";
import { OrgComponent } from "@ui_types";
import { Link } from "react-router-dom";
import { getEnvParentPath } from "@ui_lib/paths";
import { style } from "typestyle";
import { BlockUserAccessRow } from "../shared/block_user_access_row";
import * as styles from "@styles";

export const UserBlocks: OrgComponent<{ userId: string }> = (props) => {
  const userId = props.routeParams.userId;
  const graph = props.core.graph;
  const user = graph[userId] as Model.OrgUser | Model.CliUser;
  const orgRole = graph[user.orgRoleId] as Rbac.OrgRole;
  const graphUpdatedAt = props.core.graphUpdatedAt;
  const currentUserId = props.ui.loadedAccountId!;

  const {
    canReadAllOrgBlocks,
    blocks,
    appConnectionsByBlockId,
  } = useMemo(() => {
    const canReadAllOrgBlocks = g.authz.hasOrgPermission(
      graph,
      user.id,
      "blocks_read_all"
    );

    let { blocks } = g.graphTypes(graph);
    blocks = blocks.filter(
      (block) =>
        g.getConnectedAppPermissionsUnionForBlock(graph, block.id, userId)
          .size > 0
    );

    return {
      canReadAllOrgBlocks,
      blocks,
      appConnectionsByBlockId: g.getAppConnectionsByBlockId(graph, userId),
    };
  }, [graphUpdatedAt, currentUserId, userId]);

  const renderAccessRow = (block: Model.Block) => (
    <BlockUserAccessRow
      {...props}
      canReadAllOrgBlocks={canReadAllOrgBlocks}
      connectedApps={appConnectionsByBlockId[block.id] ?? []}
      orgRole={orgRole}
    />
  );

  const renderBlock = (block: Model.Block) => {
    return (
      <div>
        <div>
          <span className="title">
            <Link to={props.orgRoute(getEnvParentPath(block))}>
              {block.name}
            </Link>
          </span>
        </div>
        {canReadAllOrgBlocks ? "" : renderAccessRow(block)}
      </div>
    );
  };

  return (
    <div className={styles.ManageBlocks}>
      <h3>
        {blocks.length}
        <strong>{blocks.length == 1 ? " block" : " blocks"}</strong>
      </h3>

      {canReadAllOrgBlocks ? (
        <p>
          {user.type == "orgUser"
            ? g.getUserName(graph, user.id)
            : "This CLI Key "}{" "}
          has access to all blocks in the organization through{" "}
          {user.type == "orgUser" ? "their" : "its"}{" "}
          <strong>{orgRole.name}</strong> role.
        </p>
      ) : (
        ""
      )}

      <div className="assoc-list">{blocks.map(renderBlock)}</div>
    </div>
  );
};

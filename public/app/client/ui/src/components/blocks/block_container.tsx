import React, { useEffect } from "react";
import { OrgComponent } from "@ui_types";
import { Model, Rbac } from "@core/types";
import { fetchEnvsIfNeeded } from "@ui_lib/envs";
import { BlockTabs } from "./block_tabs";
import * as g from "@core/lib/graph";
import * as styles from "@styles";
import { SvgImage } from "@images";

let initialBlockPermissionsJson: string | undefined;
let initialOrgRoleId: string | undefined;
let initialOrgPermissionsJson: string | undefined;

export const BlockContainer: OrgComponent<{ blockId: string }> = (props) => {
  const { graph, graphUpdatedAt } = props.core;
  const block = graph[props.routeParams.blockId] as Model.Block | undefined;
  const currentUserId = props.ui.loadedAccountId!;
  const currentUser = graph[currentUserId] as Model.OrgUser;
  const orgRole = graph[currentUser.orgRoleId] as Rbac.OrgRole;
  const blockPermissionsJson = JSON.stringify(
    block
      ? Array.from(
          g.getEnvParentPermissions(graph, block.id, currentUserId)
        ).sort()
      : []
  );
  const orgPermissionsJson = JSON.stringify(
    Array.from(g.getOrgPermissions(graph, orgRole.id)).sort()
  );

  useEffect(() => {
    if (block) {
      fetchEnvsIfNeeded(props, block.id);
    }
  }, [block?.id, graphUpdatedAt]);

  useEffect(() => {
    if (block) {
      initialOrgRoleId = orgRole.id;
      initialBlockPermissionsJson = blockPermissionsJson;
      initialOrgPermissionsJson = orgPermissionsJson;
    }
  }, [block?.id]);

  useEffect(() => {
    // if (
    //   orgRole.id == initialOrgRoleId &&
    //   orgPermissionsJson == initialOrgPermissionsJson &&
    //   blockPermissionsJson != initialBlockPermissionsJson
    // ) {
    //   alert(
    //     "Your permissions for this block have been updated through a connected app."
    //   );
    // }
    initialOrgRoleId = orgRole.id;
    initialBlockPermissionsJson = blockPermissionsJson;
    initialOrgPermissionsJson = orgPermissionsJson;
  }, [blockPermissionsJson, orgRole.id, orgPermissionsJson]);

  if (!block) {
    return <div></div>;
  }

  return (
    <div className={styles.SelectedObjectContainer}>
      <header className={styles.SelectedObjectHeader}>
        <h1>
          <span>
            Block
            <SvgImage type="right-caret" />
          </span>
          <label>{block.name}</label>
        </h1>

        <BlockTabs {...props} blockId={block.id} />
      </header>
    </div>
  );
};

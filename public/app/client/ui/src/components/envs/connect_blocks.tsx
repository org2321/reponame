import React, { useState } from "react";
import { EnvManagerComponent } from "@ui_types";
import { Client, Model } from "@core/types";
import * as R from "ramda";
import * as ui from "@ui";
import * as g from "@core/lib/graph";
import * as styles from "@styles";
import { style } from "typestyle";
import { SvgImage } from "@images";

export const ConnectBlocks: EnvManagerComponent = (props) => {
  const connectableBlocks = g.authz.getConnectableBlocksForApp(
    props.core.graph,
    props.ui.loadedAccountId!,
    props.envParentId
  );

  const [submitting, setSubmitting] = useState(false);

  return (
    <div
      className={
        styles.EnvConnectBlocks +
        " " +
        style({
          height:
            props.gridHeight - (styles.layout.ENV_LABEL_ROW_HEIGHT * 2 + 28),
        })
      }
    >
      <ui.MultiSelect
        title="Block"
        actionLabel="Connect"
        emptyText="No blocks can be connected."
        winHeight={props.winHeight}
        items={connectableBlocks.map((block) => {
          return {
            id: block.id,
            searchText: block.name,
            label: <label>{block.name}</label>,
          };
        })}
        submitting={submitting}
        onSubmit={async (ids) => {
          setSubmitting(true);

          await props.dispatch({
            type: Client.ActionType.CONNECT_BLOCKS,
            payload: ids.map((blockId, i) => ({
              blockId,
              appId: props.envParentId,
              orderIndex: i,
            })),
          });

          props.setEnvManagerState({ showAddForm: false });

          setSubmitting(false);
        }}
      />
    </div>
  );
};

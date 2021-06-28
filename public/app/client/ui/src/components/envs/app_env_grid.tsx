import React from "react";
import { EnvManagerComponent } from "@ui_types";
import * as ui from "@ui";
import { Model } from "@core/types";
import * as g from "@core/lib/graph";
import * as R from "ramda";

export const AppEnvGrid: EnvManagerComponent = (props) => {
  let hasConnectedBlocks = props.connectedBlocks.length > 0;

  if (props.isSub && hasConnectedBlocks) {
    const subConnected = props.connectedBlocks.filter((block) => {
      const blockEnvironmentIds = props.localsUserId
        ? [[block.id, props.localsUserId].join("|")]
        : props.visibleEnvironmentIds.flatMap((appEnvironmentId) => {
            const [blockEnvironmentId] = g
              .getConnectedBlockEnvironmentsForApp(
                props.core.graph,
                props.envParentId,
                block.id,
                appEnvironmentId
              )
              .map(R.prop("id"));
            return blockEnvironmentId ?? "";
          });

      return blockEnvironmentIds.filter(Boolean).length > 0;
    });

    if (subConnected.length == 0) {
      hasConnectedBlocks = false;
    }
  }

  return (
    <div>
      {hasConnectedBlocks ? <ui.AppBlocks {...props} /> : ""}
      {hasConnectedBlocks && !props.editingMultiline ? (
        <div className="title-row">
          <span className="label">
            <small>App Variables</small>
          </span>
        </div>
      ) : (
        ""
      )}
      <ui.EnvGrid {...props} />
    </div>
  );
};

import React, { useLayoutEffect, useEffect, useState } from "react";
import { OrgComponent } from "@ui_types";
import {
  getPendingUpdateDetails,
  getAllPendingConflicts,
} from "@core/lib/client";
import { Client } from "@core/types";
import { style } from "typestyle";
import { ReviewPending } from "./review_pending";
import * as styles from "@styles";

export const PendingFooter: OrgComponent<
  {},
  {
    pendingUpdateDetails: ReturnType<typeof getPendingUpdateDetails>;
    pendingConflicts: ReturnType<typeof getAllPendingConflicts>;
    numPendingConflicts: number;
  }
> = (props) => {
  const {
    apps,
    appEnvironments,
    appPaths,
    blocks,
    blockPaths,
    blockEnvironments,
  } = props.pendingUpdateDetails;

  const appIds = Array.from(apps);
  const blockIds = Array.from(blocks);
  const envParentIds = appIds.concat(blockIds);

  const [isConfirmingCommitAll, setIsConfirmingCommitAll] = useState(false);
  const [isConfirmingResetAll, setIsConfirmingResetAll] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [commitMsg, setCommitMsg] = useState<string>("");

  const [dispatchedCommit, setDispatchedCommit] = useState(false);
  const [dispatchedReset, setDispatchedReset] = useState(false);

  useEffect(() => {
    if (isReviewing) {
      props.setUiState({ pendingFooterHeight: 0 });
    } else {
      if (appIds.length + blockIds.length > 0) {
        props.setUiState({
          pendingFooterHeight: isConfirmingCommitAll
            ? styles.layout.CONFIRM_PENDING_FOOTER_HEIGHT
            : styles.layout.DEFAULT_PENDING_FOOTER_HEIGHT,
        });
      }
    }
  }, [isConfirmingCommitAll, isReviewing]);

  if (isReviewing) {
    return <ReviewPending {...props} back={() => setIsReviewing(false)} />;
  }

  let footerContents: React.ReactNode[];

  if (isConfirmingCommitAll) {
    footerContents = [
      <label>
        <strong>Commit all changes?</strong>
      </label>,
      <textarea
        placeholder="Commit message (optional)"
        value={commitMsg}
        autoFocus={true}
        onChange={(e) => setCommitMsg(e.target.value)}
        disabled={dispatchedCommit}
      />,
      <div className="actions">
        <button
          className="secondary"
          disabled={dispatchedCommit}
          onClick={() => setIsConfirmingCommitAll(false)}
        >
          Cancel
        </button>
        <button
          className="primary"
          disabled={dispatchedCommit}
          onClick={() => {
            props.dispatch({
              type: Client.ActionType.COMMIT_ENVS,
              payload: {
                message: commitMsg,
              },
            });
            setDispatchedCommit(true);
          }}
        >
          Commit
        </button>
      </div>,
    ];
  } else if (isConfirmingResetAll) {
    footerContents = [
      <label>
        <strong>Reset all changes?</strong>
      </label>,
      <div className="actions">
        <button
          className="secondary"
          disabled={dispatchedReset}
          onClick={() => setIsConfirmingResetAll(false)}
        >
          Cancel
        </button>

        <button
          className="primary"
          disabled={dispatchedReset}
          onClick={() => {
            props.dispatch({
              type: Client.ActionType.RESET_ENVS,
              payload: {},
            });
            props.setUiState({
              envManager: {
                ...props.ui.envManager,
                committingToCore: {},
              },
            });
            setDispatchedReset(true);
          }}
        >
          Reset
        </button>
      </div>,
    ];
  } else {
    const summary: React.ReactNode[] = [
      <strong>Changes pending</strong>,

      <span className="sep">{"●"}</span>,
    ];
    if (apps.size) {
      summary.push(
        <strong>{`${apps.size} app${apps.size > 1 ? "s" : ""}`}</strong>
      );
      if (blocks.size > 0) {
        summary.push(", ");
      }
    }
    if (blocks.size) {
      summary.push(
        <strong>{`${blocks.size} block${blocks.size > 1 ? "s" : ""}`}</strong>
      );
    }

    // const numEnvironments = appEnvironments.size + blockEnvironments.size;
    // const numVars = appPaths.size + blockPaths.size;

    // summary.push(
    //   ` (${numEnvironments} environment${
    //     numEnvironments > 1 ? "s" : ""
    //   }, ${numVars} var${numVars > 1 ? "s" : ""})`
    // );

    if (props.numPendingConflicts > 0) {
      summary.push(
        <span className="conflicts">
          <span className="sep">{"●"}</span>
          {props.numPendingConflicts} conflict
          {props.numPendingConflicts == 1 ? "" : "s"}
        </span>
      );
    }

    footerContents = [
      <label>{summary}</label>,
      <div className="actions">
        <button className="secondary" onClick={() => setIsReviewing(true)}>
          Review
        </button>
        <button
          className="secondary"
          onClick={() => setIsConfirmingResetAll(true)}
        >
          Reset
        </button>
        <button
          className="primary"
          onClick={() => setIsConfirmingCommitAll(true)}
        >
          Commit
        </button>
      </div>,
    ];
  }

  return (
    <div
      className={
        styles.PendingEnvsFooter +
        " " +
        style({
          height: props.ui.pendingFooterHeight,
          visibility:
            appIds.length + blockIds.length > 0 ? "visible" : "hidden",
        })
      }
    >
      {footerContents}
    </div>
  );
};

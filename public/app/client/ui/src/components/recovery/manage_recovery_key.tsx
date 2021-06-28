import React, { useState, useEffect, useMemo } from "react";
import { OrgComponent } from "@ui_types";
import { Client } from "@core/types";
import * as g from "@core/lib/graph";
import { twitterShortTs } from "@core/lib/utils/date";
import * as styles from "@styles";
import { MIN_ACTION_DELAY_MS } from "@constants";
import { wait } from "@core/lib/utils/wait";

export const ManageRecoveryKey: OrgComponent<
  {},
  { requireRecoveryKey?: true; onClear?: () => any }
> = (props) => {
  const { graph, graphUpdatedAt } = props.core;
  const currentUserId = props.ui.loadedAccountId!;
  const auth = props.core.orgUserAccounts[currentUserId]!;
  const org = g.graphTypes(graph).org;

  const activeRecoveryKey = useMemo(
    () => g.getActiveRecoveryKeysByUserId(graph)[currentUserId],
    [graphUpdatedAt]
  );

  const [generating, setGenerating] = useState(false);
  const [awaitingMinDelay, setAwaitingMinDelay] = useState(false);

  useEffect(() => {
    return () => {
      props.dispatch({ type: Client.ActionType.CLEAR_GENERATED_RECOVERY_KEY });
    };
  }, []);

  useEffect(() => {
    if (
      (props.core.generatedRecoveryKey ||
        props.core.generateRecoveryKeyError) &&
      generating &&
      !awaitingMinDelay
    ) {
      setGenerating(false);
    }
  }, [props.core.isGeneratingRecoveryKey, awaitingMinDelay]);

  if (props.core.generateRecoveryKeyError) {
    console.log(
      "generate recovery key error:",
      props.core.generateRecoveryKeyError
    );
  }

  const genLabel = activeRecoveryKey
    ? "Regenerate Recovery Key"
    : "Generate Recovery Key";

  const generateButton = props.requireRecoveryKey ? (
    ""
  ) : (
    <div className="buttons">
      <button
        className="primary"
        disabled={generating}
        onClick={() => {
          setGenerating(true);
          if (!props.requireRecoveryKey) {
            setAwaitingMinDelay(true);
            wait(MIN_ACTION_DELAY_MS).then(() => setAwaitingMinDelay(false));
          }
          props.dispatch({ type: Client.ActionType.CREATE_RECOVERY_KEY });
        }}
      >
        {generating ? "Regenerating..." : genLabel}
      </button>
    </div>
  );

  if (
    !props.requireRecoveryKey &&
    (awaitingMinDelay ||
      (activeRecoveryKey &&
        !(
          props.core.generateRecoveryKeyError || props.core.generatedRecoveryKey
        )))
  ) {
    return (
      <div className={styles.SettingsManageRecoveryKey}>
        <div className="active">
          <div>
            <span className="title">Recovery key active</span>
            <span className="subtitle">
              {generating
                ? ""
                : twitterShortTs(activeRecoveryKey!.createdAt, props.ui.now)}
            </span>
          </div>
        </div>
        <div className="buttons">{generateButton}</div>
      </div>
    );
  }

  return (
    <div
      className={
        (props.requireRecoveryKey ? "" : styles.SettingsManageRecoveryKey) +
        " " +
        styles.ManageRecoveryKey
      }
    >
      {props.core.generateRecoveryKeyError ? (
        <div>
          <p className="error">
            There was a problem generating your Recovery Key.
          </p>
        </div>
      ) : (
        ""
      )}
      {props.core.generatedRecoveryKey || props.requireRecoveryKey ? (
        <div className="field">
          <label>
            Your <strong>{org.name}</strong> Recovery Key
          </label>
          <div className="recovery-key">
            {props.core.generatedRecoveryKey
              ? [
                  ...props.core.generatedRecoveryKey.encryptionKey.split(" "),
                  auth.hostType == "self-hosted" ? auth.hostUrl : "",
                ]
                  .filter(Boolean)
                  .map((value, i) => (
                    <span>
                      {i == 4 || i == 8 ? <br /> : ""}
                      {value}{" "}
                    </span>
                  ))
              : "..."}
          </div>
          <p>
            Your Recovery Key allows you regain access to this organization if
            you lose your device or forget your device's passphrase. We
            recommend either printing it out or writing it down, then keeping it
            somewhere safe.
          </p>

          <p className="important">
            <h4>Important</h4>
            If you lose your Recovery Key and there's no other user in your
            organization with sufficient access to re-invite you, your data
            could be lost forever. EnvKey won't be able to help you if this
            happens, and is not responsible for any lost data or other
            unpleasant consequences.
          </p>

          <p>
            This key won't be shown again, but you can generate a new one at any
            time in the <strong>My Org</strong> section.
          </p>
          <div className="buttons">
            <button
              className="primary"
              onClick={() => {
                props.dispatch({
                  type: Client.ActionType.CLEAR_GENERATED_RECOVERY_KEY,
                });
                if (props.onClear) {
                  props.onClear();
                }
              }}
            >
              {props.requireRecoveryKey ? "Continue" : "Done"}
            </button>
          </div>
        </div>
      ) : (
        generateButton
      )}
    </div>
  );
};

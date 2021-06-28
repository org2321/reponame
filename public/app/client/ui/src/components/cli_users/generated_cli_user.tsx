import React, { useLayoutEffect, useEffect, useState } from "react";
import { OrgComponent } from "@ui_types";
import { Client } from "@core/types";
import { cliUserRoute } from "./helpers";
import * as g from "@core/lib/graph";
import * as styles from "@styles";

export const GeneratedCliUser: OrgComponent<{ appId?: string }> = (props) => {
  const generatedCliUsers = props.core.generatedCliUsers;
  const numGenerated = generatedCliUsers.length;
  const appId = props.routeParams.appId;

  const [clearing, setClearing] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number>();

  const dispatchClearGenerated = () =>
    props.dispatch({ type: Client.ActionType.CLEAR_GENERATED_CLI_USERS });

  useLayoutEffect(() => {
    if (numGenerated == 0) {
      props.history.replace(cliUserRoute(props, "/new-cli-key"));
    }
  }, [numGenerated == 0]);

  useEffect(() => {
    return () => {
      if (!clearing) {
        dispatchClearGenerated();
      }
    };
  }, [clearing]);

  if (numGenerated == 0) {
    return <div></div>;
  }

  const renderGenerated = (
    generated: Client.GeneratedCliUserResult,
    i: number
  ) => {
    const {
      cliKey,
      user: { name },
    } = generated;

    return (
      <div>
        <div className="name">
          <label>
            <strong>{name}</strong>
          </label>
        </div>
        <div className="token">
          <label>CLI_ENVKEY</label>

          <div>
            <span>
              {cliKey.substr(0, 20)}…
              {copiedIndex === i ? <small>Copied.</small> : ""}
            </span>
            <button
              onClick={() => {
                setCopiedIndex(i);
                props.dispatch({
                  type: Client.ActionType.WRITE_CLIPBOARD,
                  payload: { value: cliKey },
                });
              }}
            >
              Copy
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.GeneratedInvites}>
      <h3>
        CLI Key <strong>Generated</strong>
      </h3>

      <p>
        Your CLI Key has been generated. To pass it to the EnvKey CLI, either
        set it as a <code>CLI_ENVKEY</code> environment variable or use the{" "}
        <br />
        <code>--cli-envkey</code> flag.
      </p>

      <div className="generated-invites">
        {generatedCliUsers.map(renderGenerated)}
      </div>

      <div className="buttons">
        {appId ? (
          <button
            className="secondary"
            onClick={async () => {
              dispatchClearGenerated();
              props.history.push(
                props.location.pathname.replace(
                  "/add/generated-cli-key",
                  "/list"
                )
              );
            }}
            disabled={clearing}
          >
            Done
          </button>
        ) : (
          ""
        )}

        <button
          className="primary"
          onClick={async () => {
            setClearing(true);
            dispatchClearGenerated();
            props.history.push(cliUserRoute(props, "/new-cli-key"));
          }}
          disabled={clearing}
        >
          Create Another CLI Key
        </button>
      </div>
    </div>
  );
};

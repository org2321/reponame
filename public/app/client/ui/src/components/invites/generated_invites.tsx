import React, { useLayoutEffect, useEffect, useState } from "react";
import { OrgComponent } from "@ui_types";
import { Client } from "@core/types";
import { inviteRoute } from "./helpers";
import { simpleDurationString } from "@core/lib/utils/date";
import * as g from "@core/lib/graph";
import * as styles from "@styles";
import * as R from "ramda";

export const GeneratedInvites: OrgComponent<{ appId?: string }> = (props) => {
  const org = g.getOrg(props.core.graph);
  const invites = props.core.generatedInvites;
  const numInvites = invites.length;
  const firstInvite = invites[0];
  const appId = props.routeParams.appId;

  const [clearing, setClearing] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number>();

  const dispatchClearGenerated = () => {
    props.dispatch({ type: Client.ActionType.CLEAR_GENERATED_INVITES });
  };

  useLayoutEffect(() => {
    if (numInvites == 0) {
      props.history.replace(inviteRoute(props, "/invite-users"));
    }
  }, [numInvites == 0]);

  useEffect(() => {
    return () => {
      if (!clearing) {
        dispatchClearGenerated();
      }
    };
  }, []);

  useEffect(() => {
    if (props.ui.justRegeneratedInviteForUserId) {
      props.setUiState(R.omit(["justRegeneratedInviteForUserId"], props.ui));
    }
  }, []);

  if (numInvites == 0) {
    return <div></div>;
  }

  const renderGenerated = (invite: Client.GeneratedInviteResult, i: number) => {
    const {
      identityHash,
      encryptionKey,
      user: { firstName, lastName, email },
    } = invite;
    const encryptionToken = [identityHash, encryptionKey].join("_");

    return (
      <div>
        <div className="name">
          <label>
            <strong>
              {firstName} {lastName}
            </strong>{" "}
            {`<${email}>`}
          </label>
        </div>

        <div className="token">
          <label>Encryption Token</label>

          <div>
            <span>
              {encryptionToken.substr(0, 20)}…
              {copiedIndex === i ? <small>Copied.</small> : ""}
            </span>

            <button
              onClick={() => {
                setCopiedIndex(i);
                props.dispatch({
                  type: Client.ActionType.WRITE_CLIPBOARD,
                  payload: { value: encryptionToken },
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
        Invitation{numInvites > 1 ? `s` : ""} <strong>Generated</strong>
      </h3>

      <p>
        {numInvites > 1
          ? `${numInvites} invitations have been sent `
          : `An invitation has been sent to ${firstInvite.user.firstName} `}
        by <strong>email.</strong>
      </p>

      <p>
        {[
          `You also need to send ${
            numInvites > 1 ? "each person" : firstInvite.user.firstName
          } an `,
          <em>Encryption Token</em>,
          ` by any reasonably private channel that isn't the email address you used to invite them (like Slack, Twitter, LinkedIn, a text message, or a different email address).`,
        ]}
      </p>

      <p>
        {numInvites > 1 ? "These invitations" : "This invitation"} will expire
        in{" "}
        <strong>
          {simpleDurationString(org.settings.auth.inviteExpirationMs)}.
        </strong>{" "}
        {numInvites > 1 ? "Encryption Tokens" : "The Encryption Token"} can't be
        retrieved after you leave this screen, but you can always generate
        {numInvites > 1 ? " new invitations" : " a new invitation"}.
      </p>

      <div className="generated-invites">{invites.map(renderGenerated)}</div>

      <div className="buttons">
        {appId ? (
          <button
            className="secondary"
            onClick={async () => {
              dispatchClearGenerated();
              props.history.push(
                props.location.pathname.replace(
                  "/add/invite-users/generated",
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
            props.history.replace(inviteRoute(props, "/invite-users"));
          }}
          disabled={clearing}
        >
          Invite More People
        </button>
      </div>
    </div>
  );
};

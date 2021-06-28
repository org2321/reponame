import React, { useState, useEffect } from "react";
import { Component } from "@ui_types";
import { Client } from "@core/types";
import { HomeContainer } from "./home_container";
import * as styles from "@styles";
import * as R from "ramda";
import { SmallLoader, SvgImage } from "@images";
import { ExternalLink } from "../shared";

export const InitSelfHosted: Component<{ subdomain: string }> = (props) => {
  const { core, dispatch, history, routeParams } = props;
  const getLastAuthed = (state: Client.State) =>
    R.last(
      R.sortBy(
        R.prop("lastAuthAt"),
        Object.values(
          state.orgUserAccounts as Record<string, Client.ClientUserAuth>
        )
      )
    ) as Client.ClientUserAuth | undefined;

  const [errorMessage, setErrorMessage] = useState<string>("");
  const [initToken, setInitToken] = useState<string>("");
  const [initialAuthedOrgId] = useState<string | undefined>(
    getLastAuthed(core)?.orgId
  );
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  const account = core.pendingSelfHostedDeployments.find(
    (d) => d.hostUrl.split(".")[0]! === routeParams.subdomain
  );

  useEffect(() => {
    const lastAuth = getLastAuthed(core);
    if (lastAuth && lastAuth.orgId !== initialAuthedOrgId) {
      // can't send to `/org/${lastAuth.orgId}` quite yet
      history.push("/select-account");
    } else if (!account) {
      history.replace("/select-account");
    }
  }, [account?.hostUrl, initialAuthedOrgId]);

  if (!account) {
    return <HomeContainer />;
  }

  const dispatchInitToken = async () => {
    setErrorMessage("");
    if (!initToken) {
      return;
    }
    setIsVerifying(true);

    try {
      const loginRes = await dispatch({
        type: Client.ActionType.SIGN_IN_PENDING_SELF_HOSTED,
        payload: {
          initToken,
          index: core.pendingSelfHostedDeployments.findIndex(
            (d) => d.hostUrl.split(".")[0]! === routeParams.subdomain
          )!,
        },
      });
      if (!loginRes.success) {
        console.error(loginRes);
        setErrorMessage(
          (loginRes as any).errorReason ||
            (loginRes.resultAction as any)?.errorReason ||
            "Init token was not confirmed."
        );
      }
    } catch (err) {
      setErrorMessage(err.message);
    }

    setIsVerifying(false);
  };

  const addedAt = new Date(account.addedAt);
  return (
    <HomeContainer>
      <div className={styles.SignIn}>
        <h3>
          Pending Self-Hosted Deployment
          <br />
          <strong>{account.orgName}</strong>
        </h3>
        <table>
          <tbody>
            <tr>
              <th>Started At</th>
              <td>
                {addedAt.toLocaleDateString()} {addedAt.toLocaleTimeString()}
              </td>
            </tr>
            <tr>
              <th>Host</th>
              <td>
                <ExternalLink to={`https://${account.hostUrl}`}>
                  {account.hostUrl} &rarr;
                </ExternalLink>
              </td>
            </tr>
            <tr>
              <th>User Email</th>
              <td>{account.email}</td>
            </tr>
            <tr>
              <th>Deploy Tag</th>
              <td>{account.deploymentTag}</td>
            </tr>
            <tr>
              <th>Install Logs</th>
              <td>
                <ExternalLink to={account.codebuildLink}>
                  AWS CodeBuild &rarr;
                </ExternalLink>
              </td>
            </tr>
          </tbody>
        </table>
        <form
          className={styles.Register}
          onSubmit={(e) => {
            e.preventDefault();
            dispatchInitToken();
          }}
        >
          <div className="field">
            <label>Init Token</label>
            <input
              type="password"
              required
              value={initToken}
              disabled={isVerifying}
              onChange={(e) => setInitToken(e.target.value)}
            />
            <span>
              If your installation of EnvKey Self-Hosted finished successfully,
              you should have received an email at{" "}
              <strong>{account.email}</strong>.
            </span>
          </div>
          <div className="buttons">
            <input
              className="primary"
              disabled={isVerifying}
              type="submit"
              value={isVerifying ? "Initializing..." : "Submit Init Token"}
            />
          </div>
          {errorMessage ? (
            <div className="error">
              <a
                style={{ cursor: "pointer", float: "right" }}
                onClick={async (e) => {
                  e.preventDefault();
                  setErrorMessage("");
                }}
              >
                <SvgImage type="x-circle" height={21} width={21} />
              </a>
              <p>
                <strong>{errorMessage}</strong>
              </p>
              <p>
                Please ensure the installation has completed successfully and
                try again.
                <br />
                You might also need to wait for DNS records to finish
                propagating on <strong>{account.domain}</strong>.
              </p>
            </div>
          ) : null}

          <div className="back-link">
            <a
              onClick={(e) => {
                e.preventDefault();
                history.push("/select-account");
              }}
            >
              ← Back
            </a>
          </div>
        </form>
      </div>
    </HomeContainer>
  );
};

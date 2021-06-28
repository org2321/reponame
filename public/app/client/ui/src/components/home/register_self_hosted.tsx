import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Component } from "@ui_types";
import { Client } from "@core/types";
import { getDefaultOrgSettings } from "@core/lib/client/defaults";
import { HomeContainer } from "./home_container";
import * as styles from "@styles";
import {
  Region,
  primaryRegionSettings,
} from "../../../../../api/infra/src/stack-constants";
import { SmallLoader, SvgImage } from "@images";
import { wait } from "@core/lib/utils/wait";
import { ExternalLink } from "../shared";

let deployingCheckInterval: boolean = false;

export const RegisterSelfHosted: Component = (props) => {
  const { dispatch } = props;

  const [step, setStep] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  // `asdkfjals dfklasd flkjas dlfkja slkdfj alks jdflkasjd lfkajslkd`

  const [email, setEmail] = useState<string | null>("");
  const [orgName, setOrgName] = useState<string>("");
  const [firstName, setFirstName] = useState<string>("");
  const [lastName, setLastName] = useState<string>("");
  const [deviceName, setDeviceName] = useState<string>(
    props.core.defaultDeviceName ?? ""
  );
  const [profile, setProfile] = useState<string>("envkey-host");
  const [primaryRegion, setPrimaryRegion] = useState<string>("us-east-1");
  const [customDomainFlag, setCustomDomainFlag] = useState<0 | 1>(0);
  const [domain, setDomain] = useState<string>("");
  const [verifiedSenderEmail, setVerifiedSenderEmail] = useState<string>("");

  const [isRegistering, setIsRegistering] = useState<Boolean>(false);
  const [pendingDeployment, setPendingDeployment] = useState<
    Client.PendingSelfHostedDeployment | undefined
  >(undefined);

  useEffect(() => {
    if (errorMessage) {
      setIsRegistering(false);
    }
  }, [errorMessage]);

  useEffect(() => {
    (async () => {
      if (props.core.isDeployingSelfHosted) {
        setIsRegistering(false); // isDeployingSelfHosted will take over from here
        if (!deployingCheckInterval) {
          deployingCheckInterval = true;
          await props.refreshCoreState();
          while (deployingCheckInterval) {
            await wait(300);
            await props.refreshCoreState();
          }
        }
      } else {
        deployingCheckInterval = false;
      }

      if (props.core.deploySelfHostedError) {
        deployingCheckInterval = false;
        const e = props.core.deploySelfHostedError as any;
        setErrorMessage(e.errorReason || e.type);
      }
    })();
  }, [props.core.isDeployingSelfHosted, props.core.deploySelfHostedError]);

  useEffect(() => {
    const pending =
      props.core.pendingSelfHostedDeployments[
        props.core.pendingSelfHostedDeployments.length - 1
      ];
    if (!pending) {
      return;
    }
    setPendingDeployment(pending);
  }, [props.core.pendingSelfHostedDeployments]);

  const mostlyResetComponent = () => {
    setStep(0);
    setPendingDeployment(undefined);
    setErrorMessage(undefined);
    setOrgName("");
    setEmail("");
    setFirstName("");
    setLastName("");
  };

  const backStep = () => {
    const s = Math.max(step - 1, -1);
    if (s < 0) {
      props.history.length > 1
        ? props.history.goBack()
        : props.history.replace(`/create-org`);
      return;
    }
    setStep(s);
  };
  const nextStep = () => {
    setStep(step + 1);
  };

  const dispatchRegistration = async () => {
    if (!(orgName && email && firstName && lastName && deviceName)) {
      return;
    }

    setErrorMessage(undefined);
    setIsRegistering(true);

    // this action will validate all params before starting the deploy, allow the user to fix any issues and trying again
    return dispatch({
      type: Client.ActionType.REGISTER,
      payload: {
        hostType: "self-hosted",
        org: {
          name: orgName,
          settings: getDefaultOrgSettings(),
        },
        user: {
          email,
          firstName,
          lastName,
        },
        device: { name: deviceName },
        provider: "email",
        profile,
        primaryRegion,
        customDomain: customDomainFlag > 0,
        domain,
        verifiedSenderEmail,
        notifySmsWhenDone: "",
      },
    })
      .then(async (res) => {
        if (!res.success) {
          throw new Error(JSON.stringify((res.resultAction as any)?.payload));
        }
      })
      .catch((err) => {
        setIsRegistering(false);
        console.error("Registration error", { err });
        setErrorMessage(err.message);
      });
  };

  if (errorMessage) {
    return (
      <HomeContainer>
        <h3>There was a problem deploying EnvKey Self-Hosted.</h3>
        <pre className="error">{errorMessage}</pre>
        <form className={styles.Register}>
          <div className="buttons">
            <div className="back-link">
              <a
                onClick={async (e) => {
                  e.preventDefault();
                  setErrorMessage(undefined);
                  setIsRegistering(false);
                  setPendingDeployment(undefined);
                  setStep(2);
                }}
              >
                ← Back
              </a>
            </div>
          </div>
        </form>
      </HomeContainer>
    );
  }

  if (isRegistering || props.core.isDeployingSelfHosted) {
    return (
      <HomeContainer>
        <div>
          <h3>
            Configuring EnvKey Installer...
            <br />
            <SmallLoader />
            {props.core.deploySelfHostedStatus ? (
              <div>
                <pre>{props.core.deploySelfHostedStatus}</pre>
              </div>
            ) : null}
          </h3>
        </div>
      </HomeContainer>
    );
  }

  if (pendingDeployment) {
    return (
      <HomeContainer>
        <div>
          <h3>Self-Hosted EnvKey is installing.</h3>
          <h3>
            You will receive an email with an invite token for{" "}
            <strong>{pendingDeployment.orgName}</strong> when it is finished.
            <br />
            <ExternalLink to={pendingDeployment!.codebuildLink}>
              <strong>Check progress in AWS &rarr;</strong>
            </ExternalLink>
          </h3>

          <form className={styles.Register}>
            <div className="buttons">
              <div className="back-link">
                <Link to={"/select-account"}>Return to Menu</Link>
              </div>
              <div className="back-link">
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    mostlyResetComponent();
                  }}
                >
                  Deploy Another
                </a>
              </div>
            </div>
          </form>
        </div>
      </HomeContainer>
    );
  }

  switch (step) {
    case 0:
      return (
        <HomeContainer>
          <SelfHostedSetupInstructions />
          <form
            className={styles.Register}
            onSubmit={(e) => {
              e.preventDefault();
              nextStep();
            }}
          >
            <input
              className="primary"
              type="submit"
              value="My AWS account is ready to go"
            />
            <div className="buttons">
              <div className="back-link">
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    backStep();
                  }}
                >
                  ← Back
                </a>
              </div>
            </div>
          </form>
        </HomeContainer>
      );

    case 1:
      return (
        <HomeContainer>
          <SelfHostedSetupInstructionsWelcome />
          <form
            className={styles.Register}
            onSubmit={(e) => {
              e.preventDefault();
              nextStep();
            }}
          >
            <input className="primary" type="submit" value="Enter setup info" />
            <div className="buttons">
              <div className="back-link">
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    backStep();
                  }}
                >
                  ← Back
                </a>
              </div>
            </div>
          </form>
        </HomeContainer>
      );

    case 2:
      return (
        <HomeContainer>
          <form
            className={styles.Register}
            onSubmit={(e) => {
              e.preventDefault();
              if (!profile) {
                return false;
              }
              nextStep();
            }}
          >
            <div className="field">
              <label>
                AWS profile name (in{" "}
                <ExternalLink
                  className="subtitle"
                  to="https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html"
                >
                  <code>~/.aws/credentials</code>
                </ExternalLink>{" "}
                file)
              </label>
              <input
                type="text"
                placeholder="envkey-host"
                value={profile}
                required
                autoFocus={true}
                onChange={(e) => setProfile(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Primary Region</label>
              <div className="select">
                <select
                  value={primaryRegion}
                  onChange={(e) => setPrimaryRegion(e.target.value)}
                >
                  {Object.keys(primaryRegionSettings).map((r) => (
                    <option key={r}>
                      {r} (secondary:{" "}
                      {primaryRegionSettings[r as Region].failoverRegion})
                    </option>
                  ))}
                </select>
                <SvgImage type="down-caret" />
              </div>
              <span>
                Environment variables are replicated to readonly services in two
                regions. In the unlikely event of an main service outage, EnvKey
                clients employ client-side failover logic.
              </span>
            </div>
            <div className="field">
              <label>Domain Type</label>
              <div className="select">
                <select
                  value={customDomainFlag.toString()}
                  onChange={(e) =>
                    setCustomDomainFlag(parseInt(e.target.value, 10) as 1 | 0)
                  }
                >
                  <option key="custdom0" value="0">
                    Use domain purchased through Route53
                  </option>
                  <option key="custdom1" value="1">
                    Use an existing domain
                  </option>
                </select>
                <SvgImage type="down-caret" />
              </div>
              <span>
                If you purchased a domain through Route53 inside the profile
                account, EnvKey will handle all the DNS on startup.
                <br />
                Otherwise <strong>Use an existing domain</strong> to add DNS
                records manually at the end of installation.
              </span>
            </div>

            <div>
              <div className="buttons">
                <input
                  className="primary"
                  disabled={!profile}
                  type="submit"
                  value="next"
                />
              </div>

              <div className="back-link">
                <a
                  onClick={async (e) => {
                    e.preventDefault();
                    backStep();
                  }}
                >
                  ← Back
                </a>
              </div>
            </div>
          </form>
        </HomeContainer>
      );

    case 3:
      return (
        <HomeContainer>
          <form
            className={styles.Register}
            onSubmit={(e) => {
              e.preventDefault();
              if (!(domain && verifiedSenderEmail)) {
                return false;
              }
              nextStep();
            }}
          >
            <div className="field">
              <label>Domain</label>
              <input
                type="text"
                placeholder="org-secrets.com ..."
                value={domain}
                required
                autoFocus={true}
                onChange={(e) => setDomain(e.target.value)}
              />
              <span>
                Enter the root domain. A unique subdomain will be generated.
              </span>
            </div>

            <div className="field">
              <label>Verified Sender Email</label>
              <input
                type="email"
                placeholder="envkey@org-secrets.com ..."
                value={verifiedSenderEmail}
                required
                onChange={(e) => setVerifiedSenderEmail(e.target.value)}
              />
              <span>
                This is the system email address that will send invitations and
                emails from your EnvKey deployment. It must already be verified
                by SES in the profile account and primary region.
              </span>
            </div>

            <div>
              <div className="buttons">
                <input
                  className="primary"
                  disabled={!(domain && verifiedSenderEmail)}
                  type="submit"
                  value="next"
                />
              </div>

              <div className="back-link">
                <a
                  onClick={async (e) => {
                    e.preventDefault();
                    backStep();
                  }}
                >
                  ← Back
                </a>
              </div>
            </div>
          </form>
        </HomeContainer>
      );

    case 4:
      return (
        <HomeContainer>
          <form
            className={styles.Register}
            onSubmit={(e) => {
              e.preventDefault();
              dispatchRegistration();
            }}
          >
            <div className="field">
              <label>Organization Name</label>
              <input
                type="text"
                placeholder="Enter a name..."
                value={orgName || ""}
                required
                autoFocus={true}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Your Email</label>
              <input
                type="email"
                placeholder="Enter email for initial account creation..."
                value={email || ""}
                required
                onChange={(e) => setEmail(e.target.value)}
              />
              <label>Your Name</label>
              <input
                type="text"
                placeholder="Enter your first name..."
                value={firstName || ""}
                required
                onChange={(e) => setFirstName(e.target.value)}
              />
              <input
                type="text"
                placeholder="Enter your last name..."
                value={lastName || ""}
                required
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Name Of This Device</label>
              <input
                type="text"
                placeholder="Enter a name..."
                value={deviceName || ""}
                required
                onChange={(e) => setDeviceName(e.target.value)}
              />
            </div>

            <div>
              <div className="buttons">
                <input
                  className="primary"
                  disabled={
                    !(orgName && email && firstName && lastName && deviceName)
                  }
                  type="submit"
                  value="Begin Deployment Now"
                />
              </div>

              <div className="back-link">
                <a
                  onClick={async (e) => {
                    e.preventDefault();
                    backStep();
                  }}
                >
                  ← Back
                </a>
              </div>
            </div>
          </form>
        </HomeContainer>
      );

    default:
      // should not happen
      return (
        <HomeContainer>
          <h3>Invalid state</h3>
          <div className="buttons">
            <a
              onClick={async (e) => {
                e.preventDefault();
                setStep(0);
              }}
            >
              ← Back
            </a>
          </div>
        </HomeContainer>
      );
  }
};

const SelfHostedSetupInstructions: React.FC = () => (
  <section>
    <p>
      Installing EnvKey Self-Hosted is <strong>easy</strong>. It usually takes
      less than an hour, and most of that is waiting for resources to spin up.
    </p>
    <p>
      <strong>First</strong>, you need to get an AWS account ready for
      deployment.
    </p>
    <p>
      For security and simplicity,&nbsp;
      <strong>
        we strongly recommend creating a new account just for EnvKey
      </strong>
      , but you can also use an existing account if you're the rebellious type.
    </p>
    {/*  // TODO: add this page to docs */}
    <p>
      From there, follow the steps at{" "}
      <strong>
        <ExternalLink to="https://docs.envkey.com/self-hosted">
          docs.envkey.com/self-hosted
        </ExternalLink>
      </strong>
    </p>
  </section>
);

const SelfHostedSetupInstructionsWelcome: React.FC = () => (
  <section>
    <p>
      Next, you just need to supply some info in order to kick off the
      installation. It usually finishes in about 20 minutes.
    </p>
    <p>
      You'll get a link to track progress, and then an email when it's complete.
    </p>
    <p>
      <em>No data is sent anywhere other than your AWS account.</em>
    </p>
  </section>
);

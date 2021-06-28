import React, { useState, useEffect } from "react";
import { VerifyEmail, DeviceSettingsFields } from "@ui";
import { Component } from "@ui_types";
import { Client, Api } from "@core/types";
import { getDefaultOrgSettings } from "@core/lib/client/defaults";
import { dispatchDeviceSecurity } from "@ui_lib/device_security";
import { HomeContainer } from "./home_container";
import * as styles from "@styles";
import { MIN_ACTION_DELAY_MS } from "@constants";
import { wait } from "@core/lib/utils/wait";

type RegisterRes = Client.DispatchResult<
  Client.Action.SuccessAction<
    Client.Action.ClientActions["Register"],
    Api.Net.RegisterResult
  >
>;

export const RegisterCloud: Component = (props) => {
  const { core, ui, dispatch, history, setUiState } = props;

  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [orgName, setOrgName] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(
    core.defaultDeviceName ?? null
  );

  const [showingDeviceSecurity, setShowDeviceSecurity] = useState(false);

  const [requiresPassphrase, setRequiresPassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState<string>();
  const [requiresLockout, setRequiresLockout] = useState(false);
  const [lockoutMs, setLockoutMs] = useState<number>();

  const [registeredUserId, setRegisteredUserId] = useState<string>();

  const [isRegistering, setIsRegistering] = useState(false);
  const [awaitingMinDelay, setAwaitingMinDelay] = useState(false);

  const registeredAccount =
    (ui.accountId &&
      ui.accountId == registeredUserId &&
      core.orgUserAccounts[registeredUserId]) ||
    undefined;

  useEffect(() => {
    if (
      registeredAccount &&
      core.graphUpdatedAt &&
      !awaitingMinDelay &&
      ui.loadedAccountId == registeredAccount.userId
    ) {
      history.push(`/org/${registeredAccount.orgId}`);
    }
  }, [
    Boolean(registeredAccount),
    core.graphUpdatedAt,
    awaitingMinDelay,
    ui.loadedAccountId,
  ]);

  const shouldShowDeviceSecurity =
    !core.requiresPassphrase && Object.keys(core.orgUserAccounts).length == 0;

  const dispatchRegistration = async () => {
    if (!(email && token && orgName && firstName && lastName && deviceName)) {
      return;
    }
    setIsRegistering(true);
    setAwaitingMinDelay(true);

    const minDelayPromise = wait(MIN_ACTION_DELAY_MS).then(() =>
      setAwaitingMinDelay(false)
    );

    const res = (await dispatch({
      type: Client.ActionType.REGISTER,
      payload: {
        hostType: "cloud",
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
        emailVerificationToken: token,
      },
    })) as RegisterRes;

    await minDelayPromise;

    return res;
  };

  const onRegister = async (res: RegisterRes | undefined) => {
    if (!res || !res.success) {
      return;
    }
    const payload = res.resultAction.payload;

    setUiState({
      accountId: payload.userId,
      loadedAccountId: undefined,
    });

    setRegisteredUserId(payload.userId);
  };

  const onSubmitRegistration = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (shouldShowDeviceSecurity) {
      setShowDeviceSecurity(true);
    } else {
      dispatchRegistration().then(onRegister);
    }
  };

  const onSubmitDeviceSecurity = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();
    setIsRegistering(true);
    const res = await dispatchRegistration();
    if (passphrase) {
      await dispatchDeviceSecurity(dispatch, passphrase, lockoutMs);
    }
    onRegister(res);
  };

  if (!(email && token)) {
    return (
      <HomeContainer>
        <div className={styles.Register}>
          <VerifyEmail
            {...{
              ...props,
              authType: "sign_up",
              onValid: ({ email, token }) => {
                setEmail(email);
                setToken(token);
              },
            }}
          />
        </div>
      </HomeContainer>
    );
  }

  const renderRegisterButtons = () => {
    let label: string;
    if (isRegistering) {
      label = "Creating Organization...";
    } else if (shouldShowDeviceSecurity && !showingDeviceSecurity) {
      label = "Next";
    } else {
      label = "Create Organization";
    }

    return (
      <div>
        <div className="buttons">
          <input
            className="primary"
            disabled={
              isRegistering ||
              !(orgName && firstName && lastName && deviceName) ||
              (showingDeviceSecurity &&
                ((requiresPassphrase && !passphrase) ||
                  (requiresLockout && typeof lockoutMs != "number")))
            }
            type="submit"
            value={label}
          />
        </div>

        <div className="back-link">
          <a
            onClick={async (e) => {
              e.preventDefault();

              if (showingDeviceSecurity) {
                setShowDeviceSecurity(false);
              } else if (core.verifyingEmail) {
                await dispatch({
                  type: Client.ActionType.RESET_EMAIL_VERIFICATION,
                });
                setToken(null);
                setEmail(null);
              }
            }}
          >
            ← Back
          </a>
        </div>
      </div>
    );
  };

  if (showingDeviceSecurity && orgName && firstName && lastName && deviceName) {
    return (
      <HomeContainer>
        <form className={styles.Register} onSubmit={onSubmitDeviceSecurity}>
          <DeviceSettingsFields
            {...props}
            fields={["passphrase", "lockout"]}
            passphraseStrengthInputs={[
              orgName,
              firstName,
              lastName,
              deviceName,
            ]}
            disabled={isRegistering}
            onChange={({
              requiresPassphrase,
              passphrase,
              requiresLockout,
              lockoutMs,
            }) => {
              setRequiresPassphrase(requiresPassphrase ?? false);
              setPassphrase(passphrase);
              setRequiresLockout(requiresLockout ?? false);
              setLockoutMs(lockoutMs);
            }}
            focus
          />

          {renderRegisterButtons()}
        </form>
      </HomeContainer>
    );
  }

  return (
    <HomeContainer>
      <form className={styles.Register} onSubmit={onSubmitRegistration}>
        <h3>
          A bit more info is needed to <strong>create your org.</strong>
        </h3>
        <div className="field">
          <label>Organization Name</label>
          <input
            type="text"
            placeholder="Enter a name..."
            value={orgName || ""}
            disabled={isRegistering}
            required
            autoFocus
            onChange={(e) => setOrgName(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Your Name</label>
          <input
            type="text"
            placeholder="Enter your first name..."
            value={firstName || ""}
            disabled={isRegistering}
            required
            onChange={(e) => setFirstName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Enter your last name..."
            value={lastName || ""}
            disabled={isRegistering}
            required
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Name Of This Device</label>
          <input
            type="text"
            placeholder="Enter a name..."
            disabled={isRegistering}
            value={deviceName || ""}
            required
            onChange={(e) => setDeviceName(e.target.value)}
          />
        </div>
        {renderRegisterButtons()}
      </form>
    </HomeContainer>
  );
};

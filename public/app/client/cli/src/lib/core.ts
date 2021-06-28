import { BaseArgs } from "../types";
import chalk from "chalk";
import dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { spinnerWithText, stopSpinner } from "./spinner";
import { Client } from "@core/types";
import { spawn } from "child_process";
import {
  isAlive,
  coreMethod,
  dispatchCore,
  fetchState,
} from "@core/lib/core_proc";
import { getCoreProcAuthToken } from "@core/lib/client_store/key_store";
import { authenticate } from "./auth";
import { resolveUpgrades } from "./upgrades";
import { unlock } from "./crypto";
import { exit } from "./process";

const clientParams: Client.ClientParams<"cli"> = {
  clientName: "cli",
  clientVersion: "2.0",
};

let state: Client.State,
  accountIdOrCliKey: string | undefined,
  encryptedAuthToken: string | undefined,
  auth: Client.ClientUserAuth | Client.ClientCliAuth | undefined;

const isLocalDev = process.env.NODE_ENV !== "production";
const executableName = process.env.NODE_ENV === "production" ? "node" : "npm";

export const getState = () => state,
  refreshState = async (overrideAccountIdOrCliKey?: string) => {
    if (!encryptedAuthToken) {
      encryptedAuthToken = await getCoreProcAuthToken();
    }

    state = await fetchState(
      overrideAccountIdOrCliKey ?? accountIdOrCliKey,
      encryptedAuthToken
    );
    if (
      overrideAccountIdOrCliKey &&
      overrideAccountIdOrCliKey !== accountIdOrCliKey
    ) {
      accountIdOrCliKey = overrideAccountIdOrCliKey;
    }

    return state;
  },
  stopCore = async () => {
    if (!(await isAlive())) {
      return false;
    } else {
      spinnerWithText("Stopping EnvKey core process...");
      await coreMethod("stop");
      while (await isAlive()) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      stopSpinner();
      console.error("Core process stopped.\n");
      return true;
    }
  },
  restartCore = () => stopCore().then((res) => res && startCore()),
  startCore = async () => {
    if (await isAlive()) {
      return false;
    }

    const spawnArgs = isLocalDev
      ? ["run", "core-process"]
      : // The executable gets lobbed off when running inside pkg.
        // Due to vercel/pkg/prelude/bootstrap.js -> modifyShort().
        // Thus we need to just exec envkey-core.js as a node app.
        // It is inside workspace because `pkg` always includes the name
        // of the directory where it was built. See cli-builder docker script.
        ["/snapshot/workspace/envkey-core.js"];
    console.log(`Starting EnvKey core process...`);

    const child = spawn(executableName, spawnArgs, {
      detached: true,
      shell: false,
      // running core inline will do its own log file
      stdio: "ignore",
    });
    child.on("error", (err) => console.log(err));
    child.unref();

    while (!(await isAlive())) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return true;
  },
  /**
   * Sets global `state`, session/auth, and org graph.
   *
   * Has side effects - Will force application exit if failing
   * to fetch state from core_process or remote server.
   */

  initCore = async <
    RequireAuthType extends boolean,
    AuthType extends RequireAuthType extends true
      ? Client.ClientUserAuth | Client.ClientCliAuth
      : undefined = RequireAuthType extends true
      ? Client.ClientUserAuth | Client.ClientCliAuth
      : undefined
  >(
    argv: BaseArgs,
    requireAuth: RequireAuthType,
    forceChooseAccount?: true,
    lockOrUnlock?: true
  ): Promise<{ auth: AuthType; state: Client.State }> => {
    await startCore();
    encryptedAuthToken = await getCoreProcAuthToken();
    state = await fetchState(undefined, encryptedAuthToken);

    if (lockOrUnlock) {
      return { state, auth: undefined as AuthType };
    } else if (state.locked) {
      state = await unlock();
    }

    if (requireAuth) {
      ({ auth, accountIdOrCliKey } = await authenticate(
        state,
        argv,
        forceChooseAccount
      ));

      state = await fetchState(accountIdOrCliKey, encryptedAuthToken);
    }

    let fetchedSession = false;
    if (auth && auth.privkey && !state.graphUpdatedAt) {
      const res = await dispatch({
        type: Client.ActionType.GET_SESSION,
      });

      if (!res.success) {
        return exit(
          1,
          chalk.bold.red("EnvKey CLI initialization error! ") +
            JSON.stringify(res.state.fetchSessionError)
        );
      }

      state = res.state;
      fetchedSession = true;
    }

    state = await resolveUpgrades(
      state,
      auth,
      accountIdOrCliKey,
      fetchedSession
    );

    return { state, auth: auth as AuthType };
  },
  dispatch = async <T extends Client.Action.EnvkeyAction>(
    action: Client.Action.DispatchAction<T>,
    accountIdOrCliKeyFallback?: string,
    hostUrlOverride?: string
  ) => {
    const encryptedAuthToken = await getCoreProcAuthToken(),
      res = await dispatchCore(
        action,
        clientParams,
        accountIdOrCliKey ?? accountIdOrCliKeyFallback,
        hostUrlOverride,
        encryptedAuthToken
      );
    state = res.state;
    return res;
  },
  disconnect = () => dispatch({ type: Client.ActionType.DISCONNECT_CLIENT });

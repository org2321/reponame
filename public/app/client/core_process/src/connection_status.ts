import { dispatch } from "./handler";
import { Client } from "@core/types";
import isReachable from "is-reachable";
import { getContext } from "./default_context";
import { refreshSessions } from "./refresh_sessions";
import { log } from "@core/lib/utils/logger";
import { resolveOrgSockets } from "./org_sockets";
import * as R from "ramda";

/*
  Checks whether internet is reachable at all (via is-online module), and also checks each individual host.

  Also handles refreshing sessions when connectivity is restored after being unreachable.
*/

const CONNECTION_CHECK_INTERVAL = 1000 * 20; // 20 seconds

export const connectionStatusLoop = async (
  store: Client.ReduxStore,
  onOrgSocketMessageProcessed: () => void
) => {
  const state = store.getState();

  if (state.locked) {
    return;
  }

  await connectionCheck(store, onOrgSocketMessageProcessed);

  setTimeout(
    () => connectionStatusLoop(store, onOrgSocketMessageProcessed),
    CONNECTION_CHECK_INTERVAL
  );
};

const connectionCheck = async (
  store: Client.ReduxStore,
  onOrgSocketMessageProcessed: () => void
) => {
  const state = store.getState();

  if (state.locked) {
    return;
  }

  const accounts = [
    ...Object.values(state.orgUserAccounts),
    ...Object.values(state.cliKeyAccounts),
  ].filter((account) => account && !R.isEmpty(account)) as (
    | Client.ClientUserAuth
    | Client.ClientCliAuth
  )[];

  const accountsByHostUrl = R.groupBy(R.prop("hostUrl"), accounts);
  const hostUrls = Object.keys(accountsByHostUrl);

  const checkRes = await Promise.all([
    isReachable(["https://status.aws.amazon.com/", "https://www.google.com/"]),
    ...hostUrls.map((hostUrl) => isReachable(hostUrl)),
  ]);

  // if all checks fail, we've got no internet and are offline
  // if even one succeeds, then we're online
  let refreshAccountIds: string[] = [];
  const networkUnreachable = checkRes.every((res) => res === false);
  let networkReachableAgain = false;
  let anyChange = false;

  if (networkUnreachable) {
    if (!state.networkUnreachable) {
      anyChange = true;
      log("Internet is unreachable.");
      dispatch({ type: Client.ActionType.NETWORK_UNREACHABLE }, getContext());
    }
  } else if (state.networkUnreachable) {
    log("Internet is reachable again.");
    networkReachableAgain = true;
    anyChange = true;
    dispatch({ type: Client.ActionType.NETWORK_REACHABLE }, getContext());
  }

  // now set / reset hostUnreachable state as needed for each account
  R.tail(checkRes).forEach((reachable, i) => {
    const hostUrl = hostUrls[i];
    const hostUrlAccounts = accountsByHostUrl[hostUrl];
    const allAccountsAlreadyUnreachable = hostUrlAccounts.every(
      (account) => state.accountStates[account.userId]?.hostUnreachable
    );
    const allAccountsAlreadyReachable = hostUrlAccounts.every(
      (account) =>
        typeof state.accountStates[account.userId]?.hostUnreachable ==
        "undefined"
    );

    if (!reachable) {
      if (!allAccountsAlreadyUnreachable) {
        if (!networkUnreachable) {
          log(`${hostUrl} is unreachable.`);
        }
        anyChange = true;
        dispatch(
          { type: Client.ActionType.HOST_UNREACHABLE, payload: { hostUrl } },
          getContext()
        );
      }
    } else if (!allAccountsAlreadyReachable) {
      refreshAccountIds = refreshAccountIds.concat(
        hostUrlAccounts
          .filter(
            (account) =>
              account.type == "clientUserAuth" &&
              account.token &&
              account.privkey &&
              state.accountStates[account.userId]?.hostUnreachable
          )
          .map(R.prop("userId"))
      );

      if (!networkReachableAgain) {
        log(`${hostUrl} is reachable again.`);
      }

      anyChange = true;
      dispatch(
        { type: Client.ActionType.HOST_REACHABLE, payload: { hostUrl } },
        getContext()
      );
    }
  });

  if (anyChange) {
    resolveOrgSockets(store, onOrgSocketMessageProcessed);
  }

  if (refreshAccountIds.length > 0) {
    await refreshSessions(state, refreshAccountIds);
  }
};

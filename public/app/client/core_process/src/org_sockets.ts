import { log } from "@core/lib/utils/logger";
import WebSocket from "isomorphic-ws";
import { Client, Api } from "@core/types";
import { getApiAuthParams } from "@core/lib/client";
import { dispatch } from "./handler";
import { getContext } from "./default_context";
import { wait } from "@core/lib/utils/wait";

const CONNECTION_TIMEOUT = 5000,
  RESET_AFTER_CONNECTION_RETRIES = 10,
  RETRY_BACKOFF_FACTOR = 1,
  CONNECT_MAX_JITTER = 1000 * 3, // 3 seconds
  sockets: Record<string, WebSocket> = {},
  retryTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};

let _onMessageProcessed: () => void;

let exiting = false;
for (let exitSignal of ["SIGTERM", "SIGINT"]) {
  process.on(exitSignal, () => {
    if (exiting) {
      process.exit();
    }

    exiting = true;
    log(
      `Received ${exitSignal} - closing org socket connections before exiting...`
    );
    closeAllSockets();
    process.exit(0);
  });
}

export const resolveOrgSockets = async (
    store: Client.ReduxStore,
    onMessageProcessed: () => void,
    skipJitter?: true
  ) => {
    _onMessageProcessed = onMessageProcessed;
    const state = store.getState();
    if (state.locked || state.networkUnreachable) {
      closeAllSockets();
      return;
    }

    const promises: Promise<any>[] = [];

    for (let account of Object.values(state.orgUserAccounts)) {
      if (!account) {
        continue;
      }
      if (
        account.token &&
        !sockets[account.userId] &&
        !retryTimeouts[account.userId] &&
        !state.accountStates[account.userId]?.hostUnreachable
      ) {
        promises.push(connectSocket(store, account.userId, -1, skipJitter));
      } else if (
        !account.token ||
        state.accountStates[account.userId]?.hostUnreachable
      ) {
        clearSocket(account.userId);
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  },
  closeAllSockets = () => {
    for (let userId in sockets) {
      clearSocket(userId);
    }
  },
  clearSocket = (userId: string) => {
    const socket = sockets[userId];
    if (socket) {
      log("Closing web socket:", { userId });
      try {
        socket.removeAllListeners();
        socket.close();
      } catch (err) {
        log("Error clearing socket: ", { err, userId });
      }

      delete sockets[userId];
    }
    clearRetryTimeout(userId);
  };

const connectSocket = async (
    store: Client.ReduxStore,
    userId: string,
    reconnectAttempt = -1,
    skipJitter?: true
  ) => {
    const procState = store.getState();
    const account = procState.orgUserAccounts[userId];

    if (!account || !account.token) {
      clearSocket(userId);
      return;
    }

    const endpoint = account.hostUrl.replace(
      /^(.+?)\.(.+)/,
      "wss://$1-socket.$2"
    );

    if (!skipJitter) {
      await wait(CONNECT_MAX_JITTER);
    }

    const socket = new WebSocket(endpoint, {
      headers: {
        authorization: JSON.stringify(getApiAuthParams(account)),
      },
      timeout: CONNECTION_TIMEOUT,
    });

    // getReconnectAttempt allows event listeners, defined below, to access the
    // the value reconnectAttempt in this scope. This value is managed and reset
    // inside connectSocket and not in any of the listeners, but it needs to be
    // available at its current value to those listeners
    const getReconnectAttempt = () => {
      if (reconnectAttempt >= RESET_AFTER_CONNECTION_RETRIES) {
        log("Could not connect, too many retries. Resetting loop.", {
          ...logSocketData,
          RESET_AFTER_CONNECTION_RETRIES,
        });
        reconnectAttempt = -1;
      }
      reconnectAttempt++;

      return reconnectAttempt;
    };

    const logSocketData = {
      socketUrl: socket.url,
      org: `${account.orgName}|${account.orgId}`,
      email: account.email,
      userId: account.userId,
    };
    // This is a bit too spammy... uncomment for debugging purposes
    // log("Connecting to Api socket server", {
    //   reconnectAttempt,
    //   ...logSocketData,
    // });

    sockets[account.userId] = socket;
    clearRetryTimeout(account.userId);

    socket.addEventListener("open", () => {
      log("Socket connected", { reconnectAttempt, ...logSocketData });
      reconnectAttempt = -1;
    });

    socket.addEventListener("message", getOnSocketUpdate(account));
    socket.addEventListener(
      "close",
      getOnSocketClosed("close", store, account, getReconnectAttempt)
    );
    socket.addEventListener(
      "error",
      getOnSocketClosed("error", store, account, getReconnectAttempt)
    );
  },
  getOnSocketUpdate = (account: Client.ClientUserAuth) => (
    evt: WebSocket.MessageEvent
  ) => {
    log("Received update message for org:", {
      fromSocketUrl: evt.target.url,
      org: account.orgName,
      email: account.email,
      userId: account.userId,
    });
    const message = JSON.parse(
      evt.data.toString()
    ) as Api.OrgSocketUpdateMessage;
    dispatch(
      {
        type: Client.ActionType.RECEIVED_ORG_SOCKET_MESSAGE,
        payload: { message, account },
      },
      getContext(account.userId)
    ).then(() => {
      if (_onMessageProcessed) {
        _onMessageProcessed();
      }
    });
  },
  clearRetryTimeout = (userId: string) => {
    if (retryTimeouts[userId]) {
      clearTimeout(retryTimeouts[userId]);
      delete retryTimeouts[userId];
    }
  },
  getOnSocketClosed = (
    type: "close" | "error",
    store: Client.ReduxStore,
    account: Client.ClientUserAuth,
    getReconnectAttempt: () => number
  ) => (evt: WebSocket.CloseEvent | WebSocket.ErrorEvent) => {
    const logSocketData = {
      org: account.orgName,
      email: account.email,
      userId: account.userId,
      message: "message" in evt ? evt.message : undefined,
    };
    log(`Socket received ${type} event`, logSocketData);
    clearSocket(account.userId);

    if ("message" in evt && evt.message.endsWith("401")) {
      // don't retry when response is unauthorized
      return;
    }

    const reconnectAttempt = getReconnectAttempt();

    const delayMillis = Math.round(
      RETRY_BACKOFF_FACTOR * (reconnectAttempt + Math.random()) ** 2 * 1000
    );
    // This is a bit too spammy... uncomment for debugging purposes
    // log("Trying again after", {
    //   delayMillis,
    //   reconnectAttempt,
    //   ...logSocketData,
    // });
    retryTimeouts[account.userId] = setTimeout(
      () => connectSocket(store, account.userId, reconnectAttempt),
      delayMillis
    );
  };

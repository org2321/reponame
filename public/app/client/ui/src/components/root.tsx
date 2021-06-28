import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { BaseRoutes } from "./routes";
import { Client } from "@core/types";
import { dispatchCore, fetchState } from "@core/lib/core_proc";
import {
  LocalUiState,
  ComponentProps,
  ComponentBaseProps,
  emptyEnvManagerState,
} from "@ui_types";
import { useWindowSize } from "@ui_lib/view";
import { forceRenderStyles } from "typestyle";
import * as styles from "@styles";
import ReconnectingWebSocket from "reconnecting-websocket";

const LOCAL_UI_STATE_KEY = "localUiState";

const clientParams: Client.ClientParams<"app"> = {
    clientName: "app",
    clientVersion: "2.0",
  },
  Root: React.FC = () => {
    const storedLocalUiStateJson = localStorage.getItem(LOCAL_UI_STATE_KEY);
    const storedLocalUiState = storedLocalUiStateJson
      ? (JSON.parse(storedLocalUiStateJson) as LocalUiState)
      : undefined;

    const [coreState, _setCoreState] = useState<Client.State>(),
      coreStateRef = useRef(coreState),
      setCoreState = (state: Client.State) => {
        coreStateRef.current = state;
        _setCoreState(state);
      },
      [uiState, _setLocalUiState] = useState<LocalUiState>({
        ...(storedLocalUiState ?? {
          accountId: undefined,
          loadedAccountId: undefined,
          envManager: emptyEnvManagerState,
          selectedCategoryFilter: "all",
          sidebarWidth: styles.layout.SIDEBAR_WIDTH,
          pendingFooterHeight: 0,
        }),
        now: Date.now(),
      }),
      uiStateRef = useRef(uiState),
      setLocalUiState = (update: Partial<LocalUiState>) => {
        const updatedState = {
          ...uiStateRef.current,
          ...update,
        };

        window.localStorage.setItem(
          LOCAL_UI_STATE_KEY,
          JSON.stringify({
            ...updatedState,
            envManager: emptyEnvManagerState,
            pendingFooterHeight: 0,
          })
        );

        uiStateRef.current = updatedState;

        _setLocalUiState(updatedState);
      },
      [winWidth, winHeight] = useWindowSize(uiState),
      fetchingStateRef = useRef(false),
      queueFetchStateRef = useRef(false),
      fetchCoreState = async () => {
        fetchingStateRef.current = true;
        const accountId = uiStateRef.current.accountId;

        await fetchState(accountId)
          .then((state) => {
            setCoreState(state);
            const loadedAccountId = uiStateRef.current.loadedAccountId;
            if (accountId != loadedAccountId) {
              setLocalUiState({ loadedAccountId: accountId });
              dispatch({
                type: Client.ActionType.SET_UI_LAST_SELECTED_ACCOUNT_ID,
                payload: { selectedAccountId: accountId },
              });
            }
            fetchingStateRef.current = false;
            if (queueFetchStateRef.current) {
              queueFetchStateRef.current = false;
              fetchCoreState();
            }
          })
          .catch((err) => {
            console.error("fetchCoreState -> fetchState error", err);
            throw err;
          });
      },
      onSocketUpdate = () => {
        if (fetchingStateRef.current) {
          queueFetchStateRef.current = true;
        } else {
          fetchCoreState();
        }
      },
      dispatch: ComponentProps["dispatch"] = (
        action,
        hostUrlOverride?: string
      ) =>
        dispatchCore(
          action,
          clientParams,
          uiStateRef.current.accountId,
          hostUrlOverride
        );

    useEffect(() => {
      window.addEventListener("beforeunload", () => {
        console.log("window beforeunload event--disconnecting client");
        if (coreState && !coreState.locked) {
          dispatch({ type: Client.ActionType.DISCONNECT_CLIENT });
        }
      });
      const client = new ReconnectingWebSocket("ws://localhost:19048");
      client.addEventListener("message", onSocketUpdate);

      fetchCoreState();
    }, []);

    useLayoutEffect(() => {
      forceRenderStyles();

      setTimeout(() => {
        document.documentElement.classList.add("loaded");
      }, 4000);
    }, []);

    useEffect(() => {
      if (
        uiStateRef.current.accountId &&
        uiStateRef.current.accountId != uiStateRef.current.loadedAccountId
      ) {
        fetchCoreState();
      }
    }, [uiStateRef.current.accountId, uiStateRef.current.loadedAccountId]);

    useEffect(() => {
      setTimeout(() => {
        setLocalUiState({ now: Date.now() });
      }, 60000);
    }, [uiState.now]);

    if (coreState) {
      const props: ComponentBaseProps = {
        core: coreState,
        ui: uiState,
        setUiState: setLocalUiState,
        refreshCoreState: fetchCoreState,
        dispatch,
        winWidth,
        winHeight,
      };
      return (
        <div className={styles.Root}>
          <div id="content">
            <BaseRoutes {...props} />
          </div>
        </div>
      );
    } else {
      return <div />;
    }
  };

export default Root;

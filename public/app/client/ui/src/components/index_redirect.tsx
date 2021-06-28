import React, { useLayoutEffect } from "react";
import { Client } from "@core/types";
import { Component } from "@ui_types";

export const IndexRedirect: Component = (props) => {
  useLayoutEffect(() => {
    let redirectAccountId = props.core.uiLastSelectedAccountId;
    let account: Client.ClientUserAuth | undefined;

    if (!redirectAccountId) {
      const accountIds = Object.keys(props.core.orgUserAccounts);
      if (accountIds.length == 1) {
        redirectAccountId = accountIds[0];
      }
    }

    if (redirectAccountId) {
      account = props.core.orgUserAccounts[redirectAccountId];
      if (!account?.token) {
        redirectAccountId = undefined;
        account = undefined;
      }
    }

    if (redirectAccountId && account) {
      props.setUiState({
        accountId: redirectAccountId,
        loadedAccountId: undefined,
      });
      props.history.replace(`/org/${account.orgId}`);
    } else {
      if (props.core.uiLastSelectedAccountId) {
        props.dispatch({
          type: Client.ActionType.SET_UI_LAST_SELECTED_ACCOUNT_ID,
          payload: { selectedAccountId: undefined },
        });
      }

      props.history.replace("/home");
    }
  }, []);

  return <div></div>;
};

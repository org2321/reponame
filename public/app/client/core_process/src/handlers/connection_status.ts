import { clientAction } from "../handler";
import { Client } from "@core/types";

clientAction<Client.Action.ClientActions["NetworkUnreachable"]>({
  type: "clientAction",
  actionType: Client.ActionType.NETWORK_UNREACHABLE,
  procStateProducer: (draft) => {
    draft.networkUnreachable = true;
  },
});

clientAction<Client.Action.ClientActions["NetworkReachable"]>({
  type: "clientAction",
  actionType: Client.ActionType.NETWORK_REACHABLE,
  procStateProducer: (draft) => {
    delete draft.networkUnreachable;
  },
});

clientAction<Client.Action.ClientActions["HostUnreachable"]>({
  type: "clientAction",
  actionType: Client.ActionType.HOST_UNREACHABLE,
  procStateProducer: (draft, { payload: { hostUrl } }) => {
    const accounts = [
      ...Object.values(draft.orgUserAccounts),
      ...Object.values(draft.cliKeyAccounts),
    ] as (Client.ClientUserAuth | Client.ClientCliAuth)[];

    for (let account of accounts) {
      if (account.hostUrl == hostUrl) {
        const accountStateDraft = draft.accountStates[account.userId];
        if (accountStateDraft) {
          accountStateDraft.hostUnreachable = true;
        }
      }
    }
  },
});

clientAction<Client.Action.ClientActions["HostReachable"]>({
  type: "clientAction",
  actionType: Client.ActionType.HOST_REACHABLE,
  procStateProducer: (draft, { payload: { hostUrl } }) => {
    const accounts = [
      ...Object.values(draft.orgUserAccounts),
      ...Object.values(draft.cliKeyAccounts),
    ] as (Client.ClientUserAuth | Client.ClientCliAuth)[];

    for (let account of accounts) {
      if (account.hostUrl == hostUrl) {
        const accountStateDraft = draft.accountStates[account.userId];
        if (accountStateDraft) {
          delete accountStateDraft.hostUnreachable;
        }
      }
    }
  },
});

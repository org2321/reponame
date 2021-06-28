import { pick } from "@core/lib/utils/object";
import { getAuth } from "@core/lib/client";
import * as R from "ramda";
import { Client, Api, Model } from "@core/types";
import { clientAction } from "../handler";
import { removeObjectProducers, renameObjectProducers } from "../lib/status";

clientAction<Client.Action.ClientActions["UpdateUserRoles"]>({
  type: "asyncClientAction",
  actionType: Client.ActionType.UPDATE_USER_ROLES,
  stateProducer: (draft, { payload, meta }) => {
    for (let { id, orgRoleId } of payload) {
      draft.isUpdatingUserRole[id] = orgRoleId;
      delete draft.updateUserRoleErrors[id];
    }
  },
  failureStateProducer: (draft, { meta: { rootAction }, payload }) => {
    for (let { id } of rootAction.payload) {
      draft.updateUserRoleErrors[id] = {
        payload: rootAction.payload,
        error: payload,
      };
    }
  },
  endStateProducer: (draft, { meta: { rootAction } }) => {
    for (let { id } of rootAction.payload) {
      delete draft.isUpdatingUserRole[id];
    }
  },
  bulkApiDispatcher: true,
  apiActionCreator: async (payload) => ({
    action: {
      type: Api.ActionType.UPDATE_USER_ROLE,
      payload: pick(["id", "orgRoleId"], payload),
    },
  }),
});

clientAction<Api.Action.RequestActions["UpdateUserRole"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.UPDATE_USER_ROLE,
  bulkDispatchOnly: true,
  graphProposer:
    ({ payload }) =>
    (graphDraft) => {
      (graphDraft[payload.id] as Model.OrgUser | Model.CliUser).orgRoleId =
        payload.orgRoleId;
    },
});

clientAction<
  Api.Action.RequestActions["RenameOrg"],
  Api.Net.ApiResultTypes["RenameOrg"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RENAME_ORG,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  stateProducer: (draft, { meta }) => {
    const auth = getAuth(draft, meta.accountIdOrCliKey);
    if (!auth || ("token" in auth && !auth.token)) {
      throw new Error("Action requires authentication");
    }
    draft.isRenaming[auth.orgId] = true;
    delete draft.renameErrors[auth.orgId];
  },
  failureStateProducer: (draft, { payload, meta }) => {
    const auth = getAuth(draft, meta.accountIdOrCliKey);
    if (!auth || ("token" in auth && !auth.token)) {
      throw new Error("Action requires authentication");
    }
    draft.renameErrors[auth.orgId] = payload;
  },
  endStateProducer: (draft, { meta }) => {
    const auth = getAuth(draft, meta.accountIdOrCliKey);
    if (!auth || ("token" in auth && !auth.token)) {
      throw new Error("Action requires authentication");
    }
    delete draft.isRenaming[auth.orgId];
  },
});

clientAction<
  Api.Action.RequestActions["UpdateOrgSettings"],
  Api.Net.ApiResultTypes["UpdateOrgSettings"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.UPDATE_ORG_SETTINGS,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  stateProducer: (draft, { meta }) => {
    const auth = getAuth(draft, meta.accountIdOrCliKey);
    if (!auth || ("token" in auth && !auth.token)) {
      throw new Error("Action requires authentication");
    }
    draft.isUpdatingSettings[auth.orgId] = true;
    delete draft.updateSettingsErrors[auth.orgId];
  },
  successStateProducer: (draft, { meta }) => {
    const accountId = meta.accountIdOrCliKey,
      rootActionPayload = meta.rootAction.payload,
      cryptoSettings = rootActionPayload.crypto;

    if (cryptoSettings) {
      const authDraft = getAuth(draft, accountId);

      if (authDraft && authDraft.type == "clientUserAuth") {
        if (typeof cryptoSettings.requiresPassphrase == "boolean") {
          authDraft.requiresPassphrase = cryptoSettings.requiresPassphrase;
        }

        if (typeof cryptoSettings.requiresLockout == "boolean") {
          authDraft.requiresLockout = cryptoSettings.requiresLockout;

          if (!cryptoSettings.requiresLockout) {
            delete authDraft.lockoutMs;
          }
        }

        if (typeof cryptoSettings.lockoutMs == "number") {
          authDraft.lockoutMs = cryptoSettings.lockoutMs;
        }
      }
    }
  },
  failureStateProducer: (draft, { payload, meta }) => {
    const auth = getAuth(draft, meta.accountIdOrCliKey);
    if (!auth || ("token" in auth && !auth.token)) {
      throw new Error("Action requires authentication");
    }
    draft.updateSettingsErrors[auth.orgId] = payload;
  },
  endStateProducer: (draft, { meta }) => {
    const auth = getAuth(draft, meta.accountIdOrCliKey);
    if (!auth || ("token" in auth && !auth.token)) {
      throw new Error("Action requires authentication");
    }
    delete draft.isUpdatingSettings[auth.orgId];
  },
});

clientAction<
  Api.Action.RequestActions["RenameUser"],
  Api.Net.ApiResultTypes["RenameUser"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RENAME_USER,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...renameObjectProducers,
});

clientAction<
  Api.Action.RequestActions["RemoveFromOrg"],
  Api.Net.ApiResultTypes["RemoveFromOrg"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.REMOVE_FROM_ORG,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
  successStateProducer: (
    draft,
    {
      meta: {
        accountIdOrCliKey,
        rootAction: {
          payload: { id },
        },
      },
    }
  ) => {
    const auth = getAuth(draft, accountIdOrCliKey);
    if (!auth || ("token" in auth && !auth.token)) {
      throw new Error("Action requires authentication");
    }

    if (id in draft.orgUserAccounts) {
      let defaultAccountId =
        draft.defaultAccountId === id ? undefined : draft.defaultAccountId;
      const orgUserAccounts = R.omit([id], draft.orgUserAccounts),
        remainingAccounts =
          Object.values<Client.ClientUserAuth>(orgUserAccounts);

      if (remainingAccounts.length == 1) {
        defaultAccountId = remainingAccounts[0]!.userId;
      }

      if (id == auth.userId) {
        return {
          ...draft,
          ...Client.defaultAccountState,
          ...Client.defaultClientState,
          orgUserAccounts,
          defaultAccountId,
        };
      } else {
        return {
          ...draft,
          orgUserAccounts,
          defaultAccountId,
        };
      }
    }
  },
});

clientAction<
  Api.Action.RequestActions["DeleteOrg"],
  Api.Net.ApiResultTypes["DeleteOrg"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.DELETE_ORG,
  loggableType: "authAction",
  loggableType2: "orgAction",
  authenticated: true,
  graphAction: true,
  stateProducer: (draft, { meta }) => {
    const auth = getAuth(draft, meta.accountIdOrCliKey);
    if (!auth || ("token" in auth && !auth.token)) {
      throw new Error("Action requires authentication");
    }
    draft.isRemoving[auth.orgId] = true;
    delete draft.removeErrors[auth.orgId];
  },
  successStateProducer: (draft, { meta: { accountIdOrCliKey } }) => ({
    ...draft,
    ...Client.defaultAccountState,
    ...Client.defaultClientState,
    orgUserAccounts: R.omit([accountIdOrCliKey!], draft.orgUserAccounts),
  }),
  failureStateProducer: (draft, { payload, meta }) => {
    const auth = getAuth(draft, meta.accountIdOrCliKey);
    if (!auth || ("token" in auth && !auth.token)) {
      throw new Error("Action requires authentication");
    }
    draft.removeErrors[auth.orgId] = payload;
    delete draft.isRemoving[auth.orgId];
  },
});

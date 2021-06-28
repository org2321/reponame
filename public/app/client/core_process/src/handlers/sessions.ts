import { clearOrphanedBlobsProducer } from "@core/lib/client/blob";
import * as R from "ramda";
import {
  decryptedEnvsStateProducer,
  fetchRequiredPendingEnvs,
} from "../lib/envs";
import { Client, Api, Model } from "@core/types";
import { clientAction, dispatch } from "../handler";
import { pick } from "@core/lib/utils/pick";
import { getAuth } from "@core/lib/client";
import { verifyCurrentUser } from "../lib/trust";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { log } from "@core/lib/utils/logger";

clientAction<
  Client.Action.ClientActions["CreateSession"],
  Partial<Pick<Client.State, "envs">> & {
    timestamp: number;
  }
>({
  type: "asyncClientAction",
  actionType: Client.ActionType.CREATE_SESSION,
  stateProducer: (draft) => {
    draft.isCreatingSession = true;
    delete draft.createSessionError;
    delete draft.trustedRoot;
    draft.graph = {};
    delete draft.graphUpdatedAt;
    draft.trustedSessionPubkeys = {};
    delete draft.fetchSessionError;
  },
  endStateProducer: (draft) => {
    delete draft.isCreatingSession;
    delete draft.verifyingEmail;
    delete draft.emailVerificationCode;
  },
  failureStateProducer: (draft, { payload }) => {
    draft.createSessionError = payload;
  },
  handler: async (
    state,
    action,
    { context: contextParams, dispatchSuccess, dispatchFailure }
  ) => {
    const { payload } = action;
    let auth = state.orgUserAccounts[
      payload.accountId
    ] as Client.ClientUserAuth;
    if (!auth) {
      throw new Error("Invalid account");
    }

    if (auth.provider == "email" && !payload.emailVerificationToken) {
      throw new Error("emailVerificationToken required");
    } else if (auth.provider != "email" && !payload.externalAuthSessionId) {
      throw new Error("externalAuthSessionId required");
    }

    const context = { ...contextParams, hostUrl: auth.hostUrl };

    const signature = naclUtil.encodeBase64(
        nacl.sign.detached(
          naclUtil.decodeUTF8(
            JSON.stringify(
              R.props(["userId", "orgId", "deviceId", "provider"], auth)
            )
          ),
          naclUtil.decodeBase64(auth.privkey.keys.signingKey)
        )
      ),
      apiRes = await dispatch(
        {
          type: Api.ActionType.CREATE_SESSION,
          payload: {
            ...pick(["orgId", "userId", "deviceId"], auth),
            signature,
            ...(auth.provider == "email"
              ? {
                  provider: auth.provider,
                  emailVerificationToken: payload.emailVerificationToken!,
                }
              : {
                  provider: auth.provider,
                  externalAuthSessionId: payload.externalAuthSessionId!,
                }),
          },
        },
        { ...context, rootClientAction: action }
      );

    if (!apiRes.success) {
      return dispatchFailure((apiRes.resultAction as any).payload, context);
    }

    const timestamp = ((apiRes.resultAction as any)
      .payload as Api.Net.SessionResult).timestamp;

    try {
      const verifyRes = await verifyCurrentUser(apiRes.state, context);

      if (!verifyRes.success) {
        throw new Error("Couldn't verify current user");
      }

      const fetchPendingRes = await fetchRequiredPendingEnvs(
        verifyRes.state,
        context
      );

      if (fetchPendingRes && !R.all((res) => res.success, fetchPendingRes)) {
        throw new Error(
          "Error fetching latest environments with pending changes"
        );
      }
    } catch (error) {
      return dispatchFailure({ type: "clientError", error }, context);
    }

    return dispatchSuccess({ timestamp }, context);
  },
});

clientAction<
  Api.Action.RequestActions["CreateSession"],
  Api.Net.ApiResultTypes["CreateSession"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.CREATE_SESSION,
  loggableType: "authAction",
  successStateProducer: (draft, { meta, payload }) => {
    const accountId = payload.userId,
      orgAccount = draft.orgUserAccounts[accountId],
      org = payload.graph[payload.orgId] as Model.Org;

    draft.orgUserAccounts[accountId] = {
      ...orgAccount,
      ...pick(
        [
          "token",
          "email",
          "firstName",
          "lastName",
          "uid",
          "provider",
          "userId",
          "deviceId",
        ],
        payload
      ),
      externalAuthProviderId:
        draft.completedExternalAuth?.externalAuthProviderId,
      lastAuthAt: payload.timestamp,
      orgName: org.name,
      requiresPassphrase: org.settings.crypto.requiresPassphrase,
      requiresLockout: org.settings.crypto.requiresLockout,
      lockoutMs: org.settings.crypto.lockoutMs,
    } as Client.ClientUserAuth;

    if (payload.type == "tokenSession") {
      draft.signedTrustedRoot = payload.signedTrustedRoot;
    }

    draft.graph = payload.graph;
    draft.graphUpdatedAt = payload.graphUpdatedAt;
  },
});

clientAction<
  Client.Action.ClientActions["GetSession"],
  Partial<Pick<Client.State, "envs">> & {
    timestamp: number;
  }
>({
  type: "asyncClientAction",
  actionType: Client.ActionType.GET_SESSION,
  stateProducer: (draft) => {
    draft.isFetchingSession = true;
    delete draft.fetchSessionError;
  },
  failureStateProducer: (draft, { payload }) => {
    draft.fetchSessionError = payload;
  },
  endStateProducer: (draft) => {
    delete draft.isFetchingSession;
  },
  successStateProducer: decryptedEnvsStateProducer,
  handler: async (
    state,
    action,
    { context, dispatchSuccess, dispatchFailure }
  ) => {
    let auth = getAuth<Client.ClientUserAuth>(state, context.accountIdOrCliKey);
    if (!auth) {
      throw new Error("Action requires authentication and decrypted privkey");
    }

    const apiRes = await dispatch(
      {
        type: Api.ActionType.GET_SESSION,
        payload: {},
      },
      { ...context, rootClientAction: action }
    );

    if (!apiRes.success) {
      return dispatchFailure((apiRes.resultAction as any).payload, context);
    }

    const timestamp = ((apiRes.resultAction as any)
      .payload as Api.Net.SessionResult).timestamp;

    try {
      const verifyRes = await verifyCurrentUser(apiRes.state, context);

      if (!verifyRes.success) {
        throw new Error("Couldn't verify current user");
      }

      const fetchPendingRes = await fetchRequiredPendingEnvs(
        verifyRes.state,
        context
      );

      if (fetchPendingRes && !R.all((res) => res.success, fetchPendingRes)) {
        throw new Error(
          "Error fetching latest environments with pending changes"
        );
      }
    } catch (error) {
      return dispatchFailure({ type: "clientError", error }, context);
    }

    return dispatchSuccess({ timestamp }, context);
  },
});

clientAction<Client.Action.ClientActions["SelectDefaultAccount"]>({
  type: "clientAction",
  actionType: Client.ActionType.SELECT_DEFAULT_ACCOUNT,
  stateProducer: (draft, { payload: { accountId } }) => ({
    ...draft,
    ...Client.defaultAccountState,
    ...Client.defaultClientState,
    defaultAccountId: accountId,
  }),
});

clientAction<Client.Action.ClientActions["SignOut"]>({
  type: "asyncClientAction",
  actionType: Client.ActionType.SIGN_OUT,
  successStateProducer: (
    draft,
    {
      meta: {
        rootAction: {
          payload: { accountId },
        },
      },
    }
  ) =>
    ({
      ...draft,
      ...Client.defaultAccountState,
      ...Client.defaultClientState,
      orgUserAccounts: {
        ...draft.orgUserAccounts,
        [accountId]: R.omit(["token"], draft.orgUserAccounts[accountId] ?? {}),
      },
    } as Client.State),
  handler: async (
    state,
    action,
    { context, dispatchSuccess, dispatchFailure }
  ) => {
    const {
      payload: { accountId },
    } = action;

    // clear server token
    // if it fails we still just sign out on the client-side
    try {
      await dispatch(
        {
          type: Api.ActionType.CLEAR_TOKEN,
          payload: {},
        },
        { ...context, rootClientAction: action }
      );
    } catch (err) {}

    return dispatchSuccess(null, context);
  },
});

clientAction<Client.Action.ClientActions["SignInPendingSelfHosted"]>({
  type: "asyncClientAction",
  actionType: Client.ActionType.SIGN_IN_PENDING_SELF_HOSTED,
  stateProducer: (draft, { meta, payload: { index, initToken } }) => {
    let orgId: string, userId: string, deviceId: string, token: string;

    const throwInvalidTokenErr = () => {
      throw new Error("Invalid self-hosted init token");
    };

    try {
      const parsed = JSON.parse(
        naclUtil.encodeUTF8(naclUtil.decodeBase64(initToken))
      ) as [string, string, string, string];

      if (parsed.length != 4 || !R.all((s) => typeof s == "string", parsed)) {
        return throwInvalidTokenErr();
      }

      [orgId, userId, deviceId, token] = parsed;

      const pendingAuth = draft.pendingSelfHostedDeployments[index];
      const now = Date.now();

      draft.orgUserAccounts[userId] = {
        ...R.omit(
          [
            "type",
            "subdomain",
            "domain",
            "codebuildLink",
            "registerAction",
            "customDomain",
            "verifiedSenderEmail",
            "notifySmsWhenDone",
          ],
          pendingAuth
        ),
        type: "clientUserAuth",
        orgId,
        userId,
        deviceId,
        token,
        addedAt: now,
        lastAuthAt: now,
      };

      delete draft.authenticatePendingSelfHostedAccountError;
      draft.authenticatingPendingSelfHostedAccountId = userId;
    } catch (err) {
      return throwInvalidTokenErr();
    }
  },
  failureStateProducer: (draft, { meta, payload }) => {
    draft.authenticatePendingSelfHostedAccountError = payload;
  },
  successStateProducer: (draft, { meta, payload }) => {
    const index = meta.rootAction.payload.index;
    draft.pendingSelfHostedDeployments.splice(index, 1);
  },
  endStateProducer: (draft, { meta, payload }) => {
    delete draft.authenticatingPendingSelfHostedAccountId;
  },
  handler: async (
    state,
    { payload: { index, initToken } },
    { context, dispatchSuccess, dispatchFailure }
  ) => {
    if (!state.authenticatingPendingSelfHostedAccountId) {
      throw new Error("state.authenticatingPendingSelfHostedAccountId not set");
    }

    const dispatchContext = {
      ...context,
      accountIdOrCliKey: state.authenticatingPendingSelfHostedAccountId,
    };

    const res = await dispatch(
      { type: Client.ActionType.GET_SESSION },
      dispatchContext
    );

    return res.success
      ? dispatchSuccess(null, dispatchContext)
      : dispatchFailure((res.resultAction as any).payload, dispatchContext);
  },
});

clientAction<
  Api.Action.RequestActions["GetSession"],
  Api.Net.ApiResultTypes["GetSession"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.GET_SESSION,
  loggableType: "fetchMetaAction",
  authenticated: true,
  failureStateProducer: (draft, { meta, payload }) => {
    const accountId = meta.accountIdOrCliKey;
    if (!accountId) {
      return;
    }

    if (
      typeof payload.error == "object" &&
      "code" in payload.error &&
      payload.error.code == 401
    ) {
      return {
        ...draft,
        ...Client.defaultAccountState,
        ...Client.defaultClientState,
        orgUserAccounts: {
          ...draft.orgUserAccounts,
          [accountId]: R.omit(
            ["token"],
            draft.orgUserAccounts[accountId] ?? {}
          ),
        },
      } as Client.State;
    }
  },
  successStateProducer: (draft, { meta, payload }) => {
    const accountId = meta.accountIdOrCliKey!,
      orgAccount = draft.orgUserAccounts[accountId]!,
      org = payload.graph[payload.orgId] as Model.Org;

    draft.orgUserAccounts[accountId] = {
      ...orgAccount,
      ...pick(
        [
          "token",
          "email",
          "firstName",
          "lastName",
          "uid",
          "provider",
          "userId",
          "deviceId",
        ],
        payload
      ),
      lastAuthAt: payload.timestamp,
      orgName: org.name,
      requiresPassphrase: org.settings.crypto.requiresPassphrase,
      requiresLockout: org.settings.crypto.requiresLockout,
      lockoutMs: org.settings.crypto.lockoutMs,
    } as Client.ClientUserAuth;

    draft.signedTrustedRoot = payload.signedTrustedRoot;
    draft.graph = payload.graph;
    draft.graphUpdatedAt = payload.graphUpdatedAt;

    clearOrphanedBlobsProducer(draft, orgAccount.userId, orgAccount.deviceId);
  },
});

clientAction<Api.Action.RequestActions["ClearToken"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.CLEAR_TOKEN,
  loggableType: "authAction",
  authenticated: true,
});

clientAction<Api.Action.RequestActions["ClearUserTokens"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.CLEAR_USER_TOKENS,
  loggableType: "authAction",
  authenticated: true,
  stateProducer: (draft, { payload: { userId } }) => {
    draft.isClearingUserTokens[userId] = true;
  },
  endStateProducer: (
    draft,
    {
      meta: {
        rootAction: {
          payload: { userId },
        },
      },
    }
  ) => {
    delete draft.isClearingUserTokens[userId];
  },
  successStateProducer: (
    draft,
    {
      meta: {
        accountIdOrCliKey,
        rootAction: {
          payload: { userId },
        },
      },
    }
  ) => {
    // if user just cleared their own tokens, sign them out
    const auth = getAuth(draft, accountIdOrCliKey)!;
    if (auth.userId == userId) {
      return {
        ...draft,
        ...Client.defaultAccountState,
        ...Client.defaultClientState,
        orgUserAccounts: {
          ...draft.orgUserAccounts,
          [accountIdOrCliKey!]: R.omit(
            ["token"],
            draft.orgUserAccounts[accountIdOrCliKey!]
          ),
        },
      } as Client.State;
    }
  },
});

clientAction<Api.Action.RequestActions["ClearOrgTokens"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.CLEAR_ORG_TOKENS,
  loggableType: "authAction",
  authenticated: true,
  stateProducer: (draft) => {
    draft.isClearingOrgTokens = true;
  },
  endStateProducer: (draft) => {
    delete draft.isClearingOrgTokens;
  },
  successStateProducer: (draft, { meta: { accountIdOrCliKey } }) => {
    // since all org tokens were just cleared, sign out user
    return {
      ...draft,
      ...Client.defaultAccountState,
      ...Client.defaultClientState,
      orgUserAccounts: {
        ...draft.orgUserAccounts,
        [accountIdOrCliKey!]: R.omit(
          ["token"],
          draft.orgUserAccounts[accountIdOrCliKey!]
        ),
      },
    } as Client.State;
  },
});

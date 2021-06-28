import { getDefaultApiHostUrl } from "./../../../shared/src/env";
import { clearOrphanedBlobsProducer } from "@core/lib/client/blob";
import * as R from "ramda";
import { Client, Api, Crypto, Model } from "@core/types";
import { clientAction, dispatch } from "../handler";
import { getAuth } from "@core/lib/client";
import { verifyKeypair, verifySignedTrustedRootPubkey } from "../lib/trust";
import {
  decryptPrivateKey,
  secureRandomAlphanumeric,
  generateKeys,
  signPublicKey,
  signJson,
  sha256,
} from "@core/lib/crypto";
import {
  encryptedKeyParamsForDeviceOrInvitee,
  fetchEnvsForUserOrAccessParams,
} from "../lib/envs";
import { renameObjectProducers, removeObjectProducers } from "../lib/status";

clientAction<
  Client.Action.ClientActions["CreateCliUser"],
  Client.State["generatedCliUsers"][0]
>({
  type: "asyncClientAction",
  actionType: Client.ActionType.CREATE_CLI_USER,
  stateProducer: (draft, { payload, meta: { tempId } }) => {
    draft.generatingCliUsers[tempId] = payload;
    draft.generateCliUserErrors = {};
  },
  failureStateProducer: (draft, { meta: { tempId, rootAction }, payload }) => {
    draft.generateCliUserErrors[tempId] = {
      error: payload,
      payload: rootAction.payload,
    };
  },
  successStateProducer: (draft, { payload }) => {
    draft.generatedCliUsers.push(payload);
  },
  endStateProducer: (draft, { meta: { tempId } }) => {
    delete draft.generatingCliUsers[tempId];
  },
  handler: async (
    state,
    action,
    { context, dispatchSuccess, dispatchFailure }
  ) => {
    const { payload } = action;
    const auth = getAuth(state, context.accountIdOrCliKey);
    if (!auth || ("token" in auth && !auth.token)) {
      throw new Error("Action requires authentication");
    }

    const fetchRes = await fetchEnvsForUserOrAccessParams(
      state,
      [
        {
          accessParams: payload,
        },
      ],
      context
    );

    let stateWithFetched: Client.State | undefined;
    if (fetchRes) {
      for (let res of fetchRes) {
        if (res.success) {
          stateWithFetched = R.mergeDeepRight(
            stateWithFetched ?? {},
            res.state
          ) as Client.State;
        } else {
          return dispatchFailure((res.resultAction as any).payload, context);
        }
      }
    } else {
      stateWithFetched = state;
    }

    try {
      const [apiParams, cliKey] = await createCliUser(
          stateWithFetched!,
          payload,
          auth
        ),
        apiRes = await dispatch(
          {
            type: Api.ActionType.CREATE_CLI_USER,
            payload: apiParams,
          },
          { ...context, rootClientAction: action }
        );

      if (apiRes.success && apiRes.retriedWithUpdatedGraph) {
        return apiRes;
      }

      if (apiRes.success) {
        return dispatchSuccess(
          {
            user: { name: payload.name, orgRoleId: payload.orgRoleId },
            appUserGrants: payload.appUserGrants,
            cliKey,
          },
          context
        );
      } else {
        return dispatchFailure((apiRes.resultAction as any).payload, context);
      }
    } catch (err) {
      return dispatchFailure(
        {
          type: "clientError",
          error: err,
        },
        context
      );
    }
  },
});

clientAction<Client.Action.ClientActions["ClearGeneratedCliUsers"]>({
  type: "clientAction",
  actionType: Client.ActionType.CLEAR_GENERATED_CLI_USERS,
  stateProducer: (draft) => {
    draft.generatedCliUsers = [];
  },
});

clientAction<
  Api.Action.RequestActions["RenameCliUser"],
  Api.Net.ApiResultTypes["RenameCliUser"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RENAME_CLI_USER,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...renameObjectProducers,
});

clientAction<
  Client.Action.ClientActions["AuthenticateCliKey"],
  Client.ClientCliAuth
>({
  type: "asyncClientAction",
  actionType: Client.ActionType.AUTHENTICATE_CLI_KEY,
  verifyCurrentUser: true,
  stateProducer: (draft) => {
    draft.isAuthenticatingCliKey = true;
    delete draft.authenticateCliKeyError;
  },
  successStateProducer: (
    draft,
    {
      payload,
      meta: {
        rootAction: {
          payload: { cliKey },
        },
      },
    }
  ) => {
    draft.cliKeyAccounts[sha256(cliKey)] = payload;
    clearOrphanedBlobsProducer(draft, payload.userId, "cli");
  },
  failureStateProducer: (draft, { payload }) => {
    delete draft.signedTrustedRoot;
    draft.graph = {};
    delete draft.graphUpdatedAt;
    draft.authenticateCliKeyError = payload;
  },
  endStateProducer: (draft) => {
    delete draft.isAuthenticatingCliKey;
  },

  handler: async (
    state,
    action,
    { context: initialContext, dispatchSuccess, dispatchFailure }
  ) => {
    const { payload } = action;

    const cliKeyParts = payload.cliKey.split("-"),
      cliKeyIdPart = cliKeyParts[0] as string,
      encryptionKey = cliKeyParts[1] as string,
      // host may have dashes
      hostUrl = cliKeyParts[2] ? cliKeyParts.slice(2).join("-") : undefined,
      context: Client.Context = {
        ...initialContext,
        hostUrl,
        accountIdOrCliKey: payload.cliKey,
      },
      apiRes = await dispatch(
        {
          type: Api.ActionType.AUTHENTICATE_CLI_KEY,
          payload: { cliKeyIdPart },
        },
        { ...context, hostUrl, rootClientAction: action }
      );

    if (apiRes.success && apiRes.retriedWithUpdatedGraph) {
      return apiRes;
    }

    if (!apiRes.success) {
      return dispatchFailure((apiRes.resultAction as any).payload, context);
    }

    const apiPayload = (apiRes.resultAction as Client.Action.SuccessAction<
      Api.Action.RequestActions["AuthenticateCliKey"],
      Api.Net.ApiResultTypes["AuthenticateCliKey"]
    >).payload;

    try {
      const privkey = await decryptPrivateKey({
          encryptedPrivkey: apiPayload.encryptedPrivkey,
          encryptionKey,
        }),
        cliUser = apiPayload.graph[apiPayload.userId] as Model.CliUser;

      await Promise.all([
        verifyKeypair(cliUser.pubkey, privkey),
        verifySignedTrustedRootPubkey(apiRes.state, cliUser.pubkey, context),
      ]);

      return dispatchSuccess(
        {
          type: "clientCliAuth",
          userId: cliUser.id,
          orgId: apiPayload.orgId,
          privkey,
          hostUrl: hostUrl ?? getDefaultApiHostUrl(),
          lastAuthAt: apiPayload.timestamp,
          addedAt:
            state.cliKeyAccounts[sha256(payload.cliKey)]?.addedAt ??
            apiPayload.timestamp,
          ...(apiPayload.hostType == "cloud"
            ? {
                hostType: "cloud",
              }
            : {
                hostType: "self-hosted",
                deploymentTag: apiPayload.deploymentTag,
              }),
        },
        context
      );
    } catch (err) {
      return dispatchFailure({ type: "clientError", error: err }, context);
    }
  },
});

clientAction<
  Api.Action.RequestActions["CreateCliUser"],
  Api.Net.ApiResultTypes["CreateCliUser"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.CREATE_CLI_USER,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
});

clientAction<
  Api.Action.RequestActions["DeleteCliUser"],
  Api.Net.ApiResultTypes["DeleteCliUser"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.DELETE_CLI_USER,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
});

clientAction<
  Api.Action.RequestActions["AuthenticateCliKey"],
  Api.Net.ApiResultTypes["AuthenticateCliKey"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.AUTHENTICATE_CLI_KEY,
  loggableType: "authAction",
  successStateProducer: (draft, { meta, payload }) => {
    draft.signedTrustedRoot = payload.signedTrustedRoot;
    draft.graph = payload.graph;
    draft.graphUpdatedAt = payload.graphUpdatedAt;
  },
});

const createCliUser = async (
  state: Client.State,
  clientParams: Client.Action.ClientActions["CreateCliUser"]["payload"],
  auth: Client.ClientUserAuth | Client.ClientCliAuth
): Promise<[Api.Net.ApiParamTypes["CreateCliUser"], string]> => {
  if (!auth.privkey) {
    throw new Error("Action requires decrypted privkey");
  }

  const cliKeyIdPart = secureRandomAlphanumeric(26),
    encryptionKey = secureRandomAlphanumeric(26),
    trustedRoot = state.trustedRoot!,
    { pubkey, privkey, encryptedPrivkey } = await generateKeys({
      encryptionKey,
    }),
    [signedPubkey, signedTrustedRoot] = await Promise.all([
      signPublicKey({
        privkey: auth.privkey!,
        pubkey,
      }),
      signJson({
        data: trustedRoot,
        privkey,
      }),
    ]),
    accessParams: Model.AccessParams = {
      orgRoleId: clientParams.orgRoleId,
      appUserGrants: clientParams.appUserGrants,
    },
    envParams = await encryptedKeyParamsForDeviceOrInvitee(
      state,
      auth.privkey!,
      pubkey,
      undefined,
      accessParams
    );

  return [
    {
      ...envParams,
      pubkey: signedPubkey,
      encryptedPrivkey: encryptedPrivkey as Crypto.EncryptedData,
      signedTrustedRoot: { data: signedTrustedRoot },
      cliKeyIdPart,
      appUserGrants: clientParams.appUserGrants,
      name: clientParams.name,
      orgRoleId: clientParams.orgRoleId,
    },
    [
      cliKeyIdPart,
      encryptionKey,
      auth.hostType == "self-hosted" ? auth.hostUrl : undefined,
    ]
      .filter(Boolean)
      .join("-"),
  ];
};

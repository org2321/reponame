import * as R from "ramda";
import {
  getAuth,
  getTrustChain,
  getPubkeyHash,
  envsNeedFetch,
  getInheritingEnvironmentIds,
  changesetsNeedFetch,
} from "@core/lib/client";
import { Client, Api, Crypto, Model, Graph } from "@core/types";
import { clientAction, dispatch } from "../handler";
import { signJson, signPublicKey } from "@core/lib/crypto";
import { envParamsForEnvironments, fetchRequiredEnvs } from "../lib/envs";
import { verifyRootPubkeyReplacement } from "../lib/trust";
import {
  getSignedByKeyableIds,
  getEnvironmentsQueuedForReencryptionIds,
  graphTypes,
} from "@core/lib/graph";
import { log } from "@core/lib/utils/logger";
import { getUserEncryptedKeyOrBlobComposite } from "@core/lib/blob";
import produce from "immer";

clientAction<Client.Action.ClientActions["AddTrustedSessionPubkey"]>({
  type: "clientAction",
  actionType: Client.ActionType.ADD_TRUSTED_SESSION_PUBKEY,
  stateProducer: (draft, { payload }) => {
    draft.trustedSessionPubkeys[payload.id] = payload.trusted;
  },
});

clientAction<Client.Action.ClientActions["ClearTrustedSessionPubkey"]>({
  type: "clientAction",
  actionType: Client.ActionType.CLEAR_TRUSTED_SESSION_PUBKEY,
  stateProducer: (draft, { payload }) => {
    const trustedPairs = R.toPairs(draft.trustedSessionPubkeys);
    let clearingIds = [payload.id];
    while (clearingIds.length > 0) {
      const willClear: string[] = [];
      for (let clearingId of clearingIds) {
        delete draft.trustedSessionPubkeys[clearingId];
        for (let [trustedId, trusted] of trustedPairs) {
          if (trusted[trusted.length - 1] === clearingId) {
            willClear.push(trustedId);
          }
        }
      }
      clearingIds = willClear;
    }
  },
});

clientAction<Client.Action.ClientActions["SetTrustedRootPubkey"]>({
  type: "clientAction",
  actionType: Client.ActionType.SET_TRUSTED_ROOT_PUBKEY,
  stateProducer: (draft, { payload }) => {
    if (!draft.trustedRoot![payload.id]) {
      draft.trustedRoot![payload.id] = payload.trusted;
    }
  },
});

clientAction<Client.Action.ClientActions["ProcessRootPubkeyReplacements"]>({
  type: "asyncClientAction",
  actionType: Client.ActionType.PROCESS_ROOT_PUBKEY_REPLACEMENTS,
  stateProducer: (draft) => {
    draft.isProcessingRootPubkeyReplacements = true;
    delete draft.processRootPubkeyReplacementsError;
  },
  failureStateProducer: (draft, { payload }) => {
    draft.processRootPubkeyReplacementsError = payload;
  },
  endStateProducer: (draft) => {
    delete draft.isProcessingRootPubkeyReplacements;
  },
  handler: async (
    initialState,
    action,
    { context, dispatchSuccess, dispatchFailure }
  ) => {
    let state = initialState;

    if (!state.trustedRoot) {
      throw new Error("trustedRoot undefined");
    }

    const { rootPubkeyReplacements } = graphTypes(state.graph);
    if (rootPubkeyReplacements.length === 0) {
      return dispatchSuccess(null, context);
    }

    for (let replacement of rootPubkeyReplacements) {
      await verifyRootPubkeyReplacement(state, replacement);

      const res = await dispatch(
        {
          type: Client.ActionType.SET_TRUSTED_ROOT_PUBKEY,
          payload: {
            id: getPubkeyHash(replacement.replacingPubkey),
            trusted: ["root", replacement.replacingPubkey],
          },
        },
        context
      );
      state = res.state;
    }

    if (!state.trustedRoot) {
      throw new Error("trustedPubkeys undefined");
    }

    if (action.payload.commitTrusted) {
      const auth = getAuth(state, context.accountIdOrCliKey);
      if (!auth) {
        throw new Error("Authentication required for this request");
      }
      if (!auth.privkey) {
        throw new Error("privkey either undefined or encrypted");
      }

      const signedTrustedRoot = await signJson({
        data: state.trustedRoot,
        privkey: auth.privkey,
      });

      const res = await dispatch<
        Api.Action.RequestActions["UpdateTrustedRootPubkey"]
      >(
        {
          type: Api.ActionType.UPDATE_TRUSTED_ROOT_PUBKEY,
          payload: {
            signedTrustedRoot: { data: signedTrustedRoot },
            replacementIds: rootPubkeyReplacements.map(R.prop("id")),
          },
        },
        { ...context, rootClientAction: action }
      );

      if (!res.success) {
        return dispatchFailure(
          (res.resultAction as Client.Action.FailureAction)
            .payload as Api.Net.ErrorResult,
          context
        );
      }
    }

    return dispatchSuccess(null, context);
  },
});

clientAction<Client.Action.ClientActions["ProcessRevocationRequests"]>({
  type: "asyncClientAction",
  actionType: Client.ActionType.PROCESS_REVOCATION_REQUESTS,
  stateProducer: (draft) => {
    draft.isProcessingRevocationRequests = true;
    delete draft.processRevocationRequestError;
  },
  failureStateProducer: (draft, { payload }) => {
    draft.processRevocationRequestError = payload;
  },
  endStateProducer: (draft) => {
    delete draft.isProcessingRevocationRequests;
  },
  handler: async (
    initialState,
    action,
    { context, dispatchSuccess, dispatchFailure }
  ) => {
    let state = initialState;

    const currentAuth = getAuth(state, context.accountIdOrCliKey);
    if (!currentAuth || !currentAuth.privkey) {
      throw new Error("Authentication and decrypted privkey required");
    }

    const currentAuthId =
      currentAuth.type == "clientUserAuth"
        ? currentAuth.deviceId
        : currentAuth.userId;
    const privkey = currentAuth.privkey;

    const { pubkeyRevocationRequests, apps, blocks, environments } = graphTypes(
      state.graph
    );
    const byRequestId: Record<string, string> = {};
    let signedPubkeys: Record<string, Crypto.Pubkey> = {};
    let replacingRoot = false;
    const cryptoPromises: Promise<void>[] = [];

    for (let request of pubkeyRevocationRequests) {
      byRequestId[request.id] = request.targetId;

      const { isRoot } = state.graph[request.targetId] as
        | Model.OrgUserDevice
        | Model.CliUser;

      if (isRoot) {
        replacingRoot = true;
      }
    }

    for (let request of pubkeyRevocationRequests) {
      const signedByKeyableIds = getSignedByKeyableIds(
        state.graph,
        request.targetId
      );
      for (let keyableId of signedByKeyableIds) {
        const { pubkey } = state.graph[keyableId] as {
          pubkey: Crypto.Pubkey;
        };
        cryptoPromises.push(
          signPublicKey({
            privkey,
            pubkey,
          }).then((signedPubkey) => {
            signedPubkeys[keyableId] = signedPubkey;
          })
        );
      }
    }

    await Promise.all(cryptoPromises);

    // when replacing root, the replacement trust chain should end at the *previous* root, and the encrypted by trust chain should end at the *new* root

    const replacingRootTrustChain = replacingRoot
      ? await signJson({
          data: getTrustChain(state, context.accountIdOrCliKey),
          privkey,
        })
      : undefined;

    if (replacingRoot) {
      const { pubkey: currentUserPubkey, pubkeyId: currentUserPubkeyId } = state
        .graph[currentAuthId] as Model.OrgUserDevice | Model.CliUser;

      await dispatch(
        {
          type: Client.ActionType.SET_TRUSTED_ROOT_PUBKEY,
          payload: {
            id: currentUserPubkeyId,
            trusted: ["root", currentUserPubkey],
          },
        },
        context
      );

      const res = await dispatch(
        {
          type: Client.ActionType.CLEAR_TRUSTED_SESSION_PUBKEY,
          payload: { id: currentUserPubkeyId },
        },
        context
      );

      if (res.success) {
        state = res.state;
      } else {
        return dispatchFailure(
          (res.resultAction as Client.Action.FailureAction)
            .payload as Client.ClientError,
          context
        );
      }

      if (!state.trustedRoot) {
        throw new Error("trustedPubkeys undefined");
      }
    }

    const signedTrustedRoot =
      replacingRoot && state.trustedRoot
        ? await signJson({
            data: state.trustedRoot,
            privkey: currentAuth.privkey,
          })
        : undefined;

    const apiRes = await dispatch(
      {
        type: Api.ActionType.REVOKE_TRUSTED_PUBKEYS,
        payload: {
          byRequestId,
          signedPubkeys,
          replacingRootTrustChain: replacingRootTrustChain
            ? { data: replacingRootTrustChain }
            : undefined,
          signedTrustedRoot: signedTrustedRoot
            ? { data: signedTrustedRoot }
            : undefined,
        },
      },
      context
    );

    if (apiRes.success) {
      return dispatchSuccess(null, context);
    } else {
      return dispatchFailure(
        (apiRes.resultAction as Client.Action.FailureAction)
          .payload as Api.Net.ErrorResult,
        context
      );
    }
  },
});

clientAction<
  Client.Action.ClientActions["ReencryptPermittedEnvs"],
  null,
  Client.ClientError,
  Pick<Client.State, "envs" | "changesets"> & {
    reencryptEnvironmentIds: string[];
  }
>({
  type: "asyncClientAction",
  actionType: Client.ActionType.REENCRYPT_PERMITTED_ENVS,
  stateProducer: (draft, { meta }) => {
    const currentAuth = getAuth(draft, meta.accountIdOrCliKey!);
    if (!currentAuth) {
      throw new Error("Authentication and decrypted privkey required");
    }

    const reencryptEnvironmentIds = getEnvironmentsQueuedForReencryptionIds(
      draft.graph,
      currentAuth.userId
    );

    for (let environmentId of reencryptEnvironmentIds) {
      draft.isReencryptingEnvs[environmentId] = true;
      delete draft.reencryptEnvsErrors[environmentId];
    }
  },
  successStateProducer: (draft, { meta: { dispatchContext } }) => {
    for (let environmentId of dispatchContext!.reencryptEnvironmentIds) {
      let envParentId: string;
      const environment = draft.graph[environmentId] as
        | Model.Environment
        | undefined;
      if (environment) {
        envParentId = environment.envParentId;
      } else {
        [envParentId] = environmentId.split("|");
      }
      const envParent = draft.graph[envParentId] as Model.EnvParent;

      draft.envsFetchedAt[envParentId] = envParent.envsOrLocalsUpdatedAt!;
    }

    draft.envs = {
      ...draft.envs,
      ...dispatchContext!.envs,
    };

    draft.changesets = {
      ...draft.changesets,
      ...dispatchContext!.changesets,
    };
  },
  failureStateProducer: (draft, { meta: { dispatchContext }, payload }) => {
    for (let environmentId of dispatchContext!.reencryptEnvironmentIds) {
      draft.reencryptEnvsErrors[environmentId] = payload;
    }
  },
  endStateProducer: (draft, { meta: { dispatchContext } }) => {
    for (let environmentId of dispatchContext!.reencryptEnvironmentIds) {
      delete draft.isReencryptingEnvs[environmentId];
    }
  },
  handler: async (
    initialState,
    action,
    { context, dispatchSuccess, dispatchFailure }
  ) => {
    let state = initialState;

    const currentAuth = getAuth(state, context.accountIdOrCliKey);
    if (!currentAuth || !currentAuth.privkey) {
      throw new Error("Authentication and decrypted privkey required");
    }

    const reencryptEnvironmentIds = getEnvironmentsQueuedForReencryptionIds(
      state.graph,
      currentAuth.userId
    );

    const needsFetchEnvParentIds: string[] = [];
    for (let reencryptEnvironmentId of reencryptEnvironmentIds) {
      let envParentId: string;
      const environment = state.graph[reencryptEnvironmentId] as
        | Model.Environment
        | undefined;
      if (environment) {
        envParentId = environment.envParentId;
      } else {
        envParentId = reencryptEnvironmentId.split("|")[0];
      }

      if (
        envsNeedFetch(state, envParentId) ||
        changesetsNeedFetch(state, envParentId)
      ) {
        needsFetchEnvParentIds.push(envParentId);
      }
    }
    if (needsFetchEnvParentIds.length > 0) {
      const requiredEnvParentIds = new Set(needsFetchEnvParentIds);

      const fetchRequiredEnvsRes = await fetchRequiredEnvs(
        state,
        requiredEnvParentIds,
        requiredEnvParentIds,
        { ...context, skipProcessRevocationRequests: true }
      );

      if (fetchRequiredEnvsRes) {
        for (let res of fetchRequiredEnvsRes) {
          if (!res.success) {
            return dispatchFailure(
              (res.resultAction as Client.Action.FailureAction)
                .payload as Api.Net.ErrorResult,
              context
            );
          }
          state = R.mergeDeepRight(state, res.state) as Client.State;
        }
      }
    }

    const {
      keys,
      blobs,
      environmentKeysByComposite,
      reencryptChangesetKeysById,
    } = await envParamsForEnvironments({
      state,
      environmentIds: reencryptEnvironmentIds,
      rotateKeys: true,
      reencryptChangesets: true,
      context,
    });

    let encryptedByTrustChain: string | undefined;
    const hasKeyables =
      Object.keys(keys.keyableParents ?? {}).length +
        Object.keys(keys.blockKeyableParents ?? {}).length >
      0;
    if (hasKeyables) {
      const trustChain = getTrustChain(state, context.accountIdOrCliKey);

      encryptedByTrustChain = await signJson({
        data: trustChain,
        privkey: currentAuth.privkey,
      });
    }

    const apiRes = await dispatch<Api.Action.RequestActions["ReencryptEnvs"]>(
      {
        type: Api.ActionType.REENCRYPT_ENVS,
        payload: {
          keys,
          blobs,
          encryptedByTrustChain: encryptedByTrustChain
            ? { data: encryptedByTrustChain }
            : undefined,
        },
      },
      { ...context, rootClientAction: action }
    );

    if (apiRes.success && apiRes.retriedWithUpdatedGraph) {
      return apiRes;
    }

    const envs = reencryptEnvironmentIds.reduce((agg, environmentId) => {
      const environment = state.graph[environmentId] as
        | Model.Environment
        | undefined;

      const envComposite = getUserEncryptedKeyOrBlobComposite({
        environmentId,
      });
      const envState = state.envs[envComposite];

      const metaComposite = getUserEncryptedKeyOrBlobComposite({
        environmentId,
        envPart: "meta",
      });
      const metaState = state.envs[metaComposite];

      let inheritsComposite: string | undefined;
      let inheritsState: Client.State["envs"][string] | undefined;
      if (environment) {
        inheritsComposite = getUserEncryptedKeyOrBlobComposite({
          environmentId,
          envPart: "inherits",
        });
        inheritsState = state.envs[inheritsComposite];
      }

      const res = {
        ...agg,

        ...(metaState
          ? {
              [metaComposite]: {
                env: metaState.env,
                key: environmentKeysByComposite[metaComposite],
              },
            }
          : {}),

        ...(envState
          ? {
              [envComposite]: {
                env: envState.env,
                key: environmentKeysByComposite[envComposite],
              },
            }
          : {}),

        ...(inheritsComposite && inheritsState
          ? {
              [inheritsComposite]: {
                env: inheritsState.env,
                key: environmentKeysByComposite[inheritsComposite],
              },
            }
          : {}),
      };

      if (environment && !environment.isSub) {
        const inheritingEnvironmentIds = getInheritingEnvironmentIds(
          state,
          {
            envParentId: environment.envParentId,
            environmentId,
          },
          true
        );

        for (let inheritingEnvironmentId of inheritingEnvironmentIds) {
          const composite = getUserEncryptedKeyOrBlobComposite({
            environmentId: inheritingEnvironmentId,
            inheritsEnvironmentId: environment.id,
          });

          if (state.envs[composite]) {
            const key = environmentKeysByComposite[composite];
            if (!key) {
              throw new Error("Missing inheritanceOverrides key");
            }
            res[composite] = { env: state.envs[composite].env, key };
          }
        }
      }

      return res;
    }, {} as Client.State["envs"]);

    const changesets = reencryptEnvironmentIds.reduce((agg, environmentId) => {
      const environmentChangesets = state.changesets[environmentId] ?? [];

      let res = produce(agg, (draft) => {
        environmentChangesets.forEach(({ changesets }, i) => {
          const [{ id }] = changesets;

          if (!draft[environmentId]) {
            draft[environmentId] = [];
          }
          draft[environmentId][i] = {
            key: reencryptChangesetKeysById[id],
            changesets,
          };
        });
      });

      return res;
    }, {} as Client.State["changesets"]);

    const dispatchContext = {
      reencryptEnvironmentIds,
      envs,
      changesets,
    };

    if (apiRes.success) {
      return dispatchSuccess(null, {
        ...context,
        dispatchContext,
      });
    } else {
      return dispatchFailure(
        (apiRes.resultAction as Client.Action.FailureAction)
          .payload as Api.Net.ErrorResult,
        {
          ...context,
          dispatchContext,
        }
      );
    }
  },
});

clientAction<
  Api.Action.RequestActions["UpdateTrustedRootPubkey"],
  Api.Net.ApiResultTypes["UpdateTrustedRootPubkey"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.UPDATE_TRUSTED_ROOT_PUBKEY,
  loggableType: "authAction",
  authenticated: true,
  successStateProducer: (draft, { meta, payload }) => {
    for (let replacementId of meta.rootAction.payload.replacementIds) {
      delete draft.graph[replacementId];
    }
  },
});

clientAction<
  Api.Action.RequestActions["RevokeTrustedPubkeys"],
  Api.Net.ApiResultTypes["RevokeTrustedPubkeys"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.REVOKE_TRUSTED_PUBKEYS,
  loggableType: "orgAction",
  loggableType2: "authAction",
  authenticated: true,
  graphAction: true,
  skipReencryptPermitted: true,
});

clientAction<
  Api.Action.RequestActions["ReencryptEnvs"],
  Api.Net.ApiResultTypes["ReencryptEnvs"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.REENCRYPT_ENVS,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  skipReencryptPermitted: true,
  skipProcessRootPubkeyReplacements: true,
});

clientAction<Client.Action.ClientActions["VerifiedSignedTrustedRootPubkey"]>({
  type: "clientAction",
  actionType: Client.ActionType.VERIFIED_SIGNED_TRUSTED_ROOT_PUBKEY,
  stateProducer: (draft, { payload }) => {
    draft.trustedRoot = payload;
    delete draft.signedTrustedRoot;
  },
});

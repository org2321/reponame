import { clientAction, dispatch } from "@core_proc/handler";
import { Api, Client, Model } from "@core/types";
import { statusProducers } from "@core_proc/lib/status";
import { secureRandomAlphanumeric, sha256 } from "@core/lib/crypto";
import { applyPatch, Operation } from "rfc6902";

export const generateBearerSecret = (): {
  secret: string;
  hash: string;
} => {
  const secret = ["ekb", secureRandomAlphanumeric(25)].join("_");
  const hash = sha256(secret);
  return { secret, hash };
};

clientAction<Api.Action.RequestActions["CreateScimProvisioningProvider"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.CREATE_SCIM_PROVISIONING_PROVIDER,
  loggableType: "orgAction",
  graphAction: true,
  authenticated: true,
  ...statusProducers(
    "isCreatingProvisioningProvider",
    "createProvisioningProviderError"
  ),
});

clientAction<Client.Action.ClientActions["CreateScimProvisioningProvider"]>({
  type: "asyncClientAction",
  actionType: Client.ActionType.CREATE_SCIM_PROVISIONING_PROVIDER,
  stateProducer: (draft, { payload }) => {
    delete draft.createProvisioningProviderError;
    const secret =
      payload.secret ?? ["ekb", secureRandomAlphanumeric(25)].join("_");
    draft.provisioningProviderConfig = {
      secret,
    };
  },
  failureStateProducer: (draft, { payload }) => {
    draft.createProvisioningProviderError = payload;
    delete draft.provisioningProviderConfig;
  },
  successStateProducer: (draft, action) => {
    const { id, endpointBaseUrl } = action.payload.diffs.find(
      (d: Operation) => d.op === "add"
    )!.value as Model.ScimProvisioningProvider;
    draft.provisioningProviderConfig = {
      ...draft.provisioningProviderConfig!,
      id,
      endpointBaseUrl,
    };
    applyPatch(draft.graph, action.payload.diffs);
  },
  handler: async (
    initialState,
    action,
    { context, dispatchSuccess, dispatchFailure }
  ) => {
    const { nickname, authScheme } = action.payload;
    const { secret } = initialState.provisioningProviderConfig!;

    const res = await dispatch(
      {
        type: Api.ActionType.CREATE_SCIM_PROVISIONING_PROVIDER,
        payload: {
          nickname,
          authScheme,
          secret,
        },
      },
      context
    );
    if (!res.success) {
      return dispatchFailure((res.resultAction as any).payload, context);
    }
    return dispatchSuccess((res.resultAction as any).payload, context);
  },
});

clientAction<Api.Action.RequestActions["UpdateScimProvisioningProvider"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.UPDATE_SCIM_PROVISIONING_PROVIDER,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  stateProducer: (draft, { payload }) => {
    draft.isUpdatingProvisioningProvider = true;
    delete draft.updatingProvisioningProviderError;
    if (payload.secret) {
      draft.provisioningProviderConfig = {
        secret: payload.secret,
      };
    } else {
      delete draft.provisioningProviderConfig;
    }
  },
  failureStateProducer: (draft, { payload }) => {
    draft.updatingProvisioningProviderError = payload;
    delete draft.provisioningProviderConfig;
  },
  successStateProducer: (draft, action) => {
    delete draft.isUpdatingProvisioningProvider;
  },
});

clientAction<Api.Action.RequestActions["DeleteScimProvisioningProvider"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.DELETE_SCIM_PROVISIONING_PROVIDER,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...statusProducers(
    "isDeletingProvisioningProvider",
    "deleteProvisioningProviderError"
  ),
});

clientAction<Api.Action.RequestActions["ListInvitableScimUsers"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.LIST_INVITABLE_SCIM_USERS,
  loggableType: "authAction",
  loggableType2: "scimAction",
  authenticated: true,
  ...statusProducers(
    "isListingInvitableScimUsers",
    "listInvitableScimUsersError"
  ),
});

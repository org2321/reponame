import * as R from "ramda";
import { Client, Api } from "@core/types";
import { clientAction } from "../handler";
import {
  statusProducers,
  removeObjectProducers,
  updateObjectProducers,
  updateSettingsProducers,
} from "../lib/status";
import { stripEmptyRecursive, pick } from "@core/lib/utils/object";
import { deleteProposer } from "../lib/graph";
import {
  getUpdateOrgRoleProducer,
  getUpdateAppRoleProducer,
  getUpdateEnvironmentRoleProducer,
} from "@core/lib/graph";

clientAction<Client.Action.ClientActions["RbacUpdateOrgRole"]>({
  type: "asyncClientAction",
  actionType: Client.ActionType.RBAC_UPDATE_ORG_ROLE,
  ...updateObjectProducers,
  apiActionCreator: async (payload) => ({
    action: {
      type: Api.ActionType.RBAC_UPDATE_ORG_ROLE,
      payload,
    },
  }),
});

clientAction<Client.Action.ClientActions["RbacUpdateAppRole"]>({
  type: "asyncClientAction",
  actionType: Client.ActionType.RBAC_UPDATE_APP_ROLE,
  ...updateObjectProducers,
  apiActionCreator: async (payload) => ({
    action: {
      type: Api.ActionType.RBAC_UPDATE_APP_ROLE,
      payload,
    },
  }),
});

clientAction<Client.Action.ClientActions["RbacUpdateEnvironmentRole"]>({
  type: "asyncClientAction",
  actionType: Client.ActionType.RBAC_UPDATE_ENVIRONMENT_ROLE,
  ...updateObjectProducers,
  apiActionCreator: async (payload) => ({
    action: {
      type: Api.ActionType.RBAC_UPDATE_ENVIRONMENT_ROLE,
      payload,
    },
  }),
});

clientAction<Client.Action.ClientActions["IncludeAppRoles"]>({
  type: "asyncClientAction",
  actionType: Client.ActionType.INCLUDE_APP_ROLES,
  stateProducer: (draft, { payload }) => {
    for (let { appId, appRoleId } of payload) {
      draft.isIncludingAppRoles = R.assocPath(
        [appId, appRoleId],
        true,
        draft.isIncludingAppRoles
      );
      draft.includeAppRoleErrors = stripEmptyRecursive(
        R.dissocPath([appId, appRoleId], draft.includeAppRoleErrors)
      );
    }
  },
  failureStateProducer: (draft, { meta: { rootAction }, payload }) => {
    for (let { appId, appRoleId } of rootAction.payload) {
      draft.includeAppRoleErrors = R.assocPath(
        [appId, appRoleId],
        payload,
        draft.includeAppRoleErrors
      );
    }
  },
  endStateProducer: (draft, { meta: { rootAction } }) => {
    for (let { appId, appRoleId } of rootAction.payload) {
      draft.isIncludingAppRoles = stripEmptyRecursive(
        R.dissocPath([appId, appRoleId], draft.isIncludingAppRoles)
      );
    }
  },
  bulkApiDispatcher: true,
  apiActionCreator: async (payload) => ({
    action: {
      type: Api.ActionType.RBAC_CREATE_INCLUDED_APP_ROLE,
      payload: pick(["appId", "appRoleId"], payload),
    },
  }),
});

clientAction<
  Api.Action.RequestActions["RbacCreateOrgRole"],
  Api.Net.ApiResultTypes["RbacCreateOrgRole"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RBAC_CREATE_ORG_ROLE,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...statusProducers("isCreatingRbacOrgRole", "createRbacOrgRoleError"),
});

clientAction<
  Api.Action.RequestActions["RbacDeleteOrgRole"],
  Api.Net.ApiResultTypes["RbacDeleteOrgRole"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RBAC_DELETE_ORG_ROLE,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
});

clientAction<
  Api.Action.RequestActions["RbacUpdateOrgRole"],
  Api.Net.ApiResultTypes["RbacUpdateOrgRole"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RBAC_UPDATE_ORG_ROLE,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  graphProposer: ({ payload }) => getUpdateOrgRoleProducer(payload, Date.now()),
});

clientAction<
  Api.Action.RequestActions["RbacCreateAppRole"],
  Api.Net.ApiResultTypes["RbacCreateAppRole"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RBAC_CREATE_APP_ROLE,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...statusProducers("isCreatingRbacAppRole", "createRbacAppRoleError"),
});

clientAction<
  Api.Action.RequestActions["RbacDeleteAppRole"],
  Api.Net.ApiResultTypes["RbacDeleteAppRole"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RBAC_DELETE_APP_ROLE,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
});

clientAction<
  Api.Action.RequestActions["RbacUpdateAppRole"],
  Api.Net.ApiResultTypes["RbacUpdateAppRole"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RBAC_UPDATE_APP_ROLE,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  graphProposer: ({ payload }) => getUpdateAppRoleProducer(payload, Date.now()),
});

clientAction<
  Api.Action.RequestActions["RbacCreateEnvironmentRole"],
  Api.Net.ApiResultTypes["RbacCreateEnvironmentRole"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RBAC_CREATE_ENVIRONMENT_ROLE,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...statusProducers(
    "isCreatingRbacEnvironmentRole",
    "createRbacEnvironmentRoleError"
  ),
});

clientAction<
  Api.Action.RequestActions["RbacDeleteEnvironmentRole"],
  Api.Net.ApiResultTypes["RbacDeleteEnvironmentRole"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RBAC_DELETE_ENVIRONMENT_ROLE,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
});

clientAction<
  Api.Action.RequestActions["RbacUpdateEnvironmentRole"],
  Api.Net.ApiResultTypes["RbacUpdateEnvironmentRole"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RBAC_UPDATE_ENVIRONMENT_ROLE,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  graphProposer: ({ payload }) =>
    getUpdateEnvironmentRoleProducer(payload, Date.now()),
});

clientAction<
  Api.Action.RequestActions["RbacUpdateEnvironmentRoleSettings"],
  Api.Net.ApiResultTypes["RbacUpdateEnvironmentRoleSettings"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RBAC_UPDATE_ENVIRONMENT_ROLE_SETTINGS,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...updateSettingsProducers,
});

clientAction<
  Api.Action.RequestActions["RbacReorderEnvironmentRoles"],
  Api.Net.ApiResultTypes["RbacReorderEnvironmentRoles"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RBAC_REORDER_ENVIRONMENT_ROLES,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...statusProducers(
    "isReorderingEnvironmentRoles",
    "reorderEnvironmentRolesError"
  ),
});

clientAction<
  Api.Action.RequestActions["RbacCreateEnvironmentRole"],
  Api.Net.ApiResultTypes["RbacCreateEnvironmentRole"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RBAC_CREATE_ENVIRONMENT_ROLE,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...statusProducers(
    "isCreatingRbacEnvironmentRole",
    "createRbacEnvironmentRoleError"
  ),
});

clientAction<
  Api.Action.RequestActions["DeleteIncludedAppRole"],
  Api.Net.ApiResultTypes["DeleteIncludedAppRole"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.DELETE_INCLUDED_APP_ROLE,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
  graphProposer: deleteProposer,
});

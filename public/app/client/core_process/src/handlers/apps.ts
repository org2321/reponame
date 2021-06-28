import { Draft } from "immer";
import { deleteProposer } from "../lib/graph";
import { stripEmptyRecursive, pickDefined } from "@core/lib/utils/object";
import * as R from "ramda";
import { Client, Api } from "@core/types";
import { clientAction } from "../handler";
import {
  statusProducers,
  renameObjectProducers,
  removeObjectProducers,
  updateSettingsProducers,
} from "../lib/status";
import { getDeleteAppProducer } from "@core/lib/graph";

clientAction<
  Api.Action.RequestActions["CreateApp"],
  Api.Net.ApiResultTypes["CreateApp"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.CREATE_APP,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...statusProducers("isCreatingApp", "createAppError"),
});

clientAction<
  Api.Action.RequestActions["RenameApp"],
  Api.Net.ApiResultTypes["RenameApp"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.RENAME_APP,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...renameObjectProducers,
});

clientAction<
  Api.Action.RequestActions["UpdateAppSettings"],
  Api.Net.ApiResultTypes["UpdateAppSettings"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.UPDATE_APP_SETTINGS,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...updateSettingsProducers,
});

clientAction<
  Api.Action.RequestActions["DeleteApp"],
  Api.Net.ApiResultTypes["DeleteApp"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.DELETE_APP,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
  graphProposer: ({ payload: { id } }) => getDeleteAppProducer(id, Date.now()),
});

clientAction<
  Api.Action.RequestActions["RemoveAppAccess"],
  Api.Net.ApiResultTypes["RemoveAppAccess"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.REMOVE_APP_ACCESS,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
  graphProposer: deleteProposer,
});

clientAction<Client.Action.ClientActions["GrantAppsAccess"]>({
  type: "asyncClientAction",
  actionType: Client.ActionType.GRANT_APPS_ACCESS,
  stateProducer: (draft, { payload }) => {
    for (let path of appAccessStatusPaths(payload)) {
      draft.isGrantingAppAccess = R.assocPath(
        path,
        true,
        draft.isGrantingAppAccess
      );

      draft.grantAppAccessErrors = R.dissocPath(
        path,
        draft.grantAppAccessErrors
      );
    }

    draft.grantAppAccessErrors = stripEmptyRecursive(
      draft.grantAppAccessErrors
    );
  },

  failureStateProducer: (draft, { meta: { rootAction }, payload }) => {
    for (let path of appAccessStatusPaths(rootAction.payload)) {
      draft.grantAppAccessErrors = R.assocPath(
        path,
        {
          error: payload,
          payload: rootAction.payload,
        },
        draft.grantAppAccessErrors
      );
    }
  },

  endStateProducer: (draft, { meta: { rootAction } }) => {
    for (let path of appAccessStatusPaths(rootAction.payload)) {
      draft.isGrantingAppAccess = R.dissocPath(path, draft.isGrantingAppAccess);
    }
    draft.isGrantingAppAccess = stripEmptyRecursive(draft.isGrantingAppAccess);
  },

  bulkApiDispatcher: true,
  apiActionCreator: async (payload) => {
    const { appId, appGroupId, userId, userGroupId } = payload as any;

    type GrantAppAccessAction = Api.Action.GraphActions[
      | "GrantAppAccess"
      | "CreateAppUserGroup"
      | "CreateAppGroupUser"
      | "CreateAppGroupUserGroup"];

    let actionType: GrantAppAccessAction["type"];

    if (appId && userId) {
      actionType = Api.ActionType.GRANT_APP_ACCESS;
    } else if (appId && userGroupId) {
      actionType = Api.ActionType.CREATE_APP_USER_GROUP;
    } else if (appGroupId && userId) {
      actionType = Api.ActionType.CREATE_APP_GROUP_USER;
    } else if (appGroupId && userGroupId) {
      actionType = Api.ActionType.CREATE_APP_GROUP_USER_GROUP;
    }

    return {
      action: {
        type: actionType!,
        payload: pickDefined(
          ["appId", "appGroupId", "userId", "userGroupId", "appRoleId"],
          payload as any
        ),
      },
    };
  },
});

const getGraphProposer = (
  objectType: Client.Graph.UserGraphObject["type"]
) => (action: { payload: any }) => (
  graphDraft: Draft<Client.Graph.UserGraph>
) => {
  const now = Date.now(),
    { appId, appGroupId, userId, userGroupId, appRoleId } = action.payload,
    proposalId = [appId, appGroupId, userId, userGroupId]
      .filter(Boolean)
      .join("|"),
    object = {
      type: objectType,
      id: proposalId,
      createdAt: now,
      updatedAt: now,
      appRoleId,
      ...pickDefined(
        ["appId", "appGroupId", "userId", "userGroupId"],
        action.payload
      ),
    } as Client.Graph.UserGraphObject;

  graphDraft[proposalId] = object;
};

clientAction<Api.Action.RequestActions["GrantAppAccess"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.GRANT_APP_ACCESS,
  bulkDispatchOnly: true,
  graphProposer: getGraphProposer("appUserGrant"),
});

clientAction<Api.Action.RequestActions["CreateAppUserGroup"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.CREATE_APP_USER_GROUP,
  bulkDispatchOnly: true,
  graphProposer: getGraphProposer("appUserGroup"),
});

clientAction<Api.Action.RequestActions["CreateAppGroupUser"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.CREATE_APP_GROUP_USER,
  bulkDispatchOnly: true,
  graphProposer: getGraphProposer("appGroupUser"),
});

clientAction<Api.Action.RequestActions["CreateAppGroupUserGroup"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.CREATE_APP_GROUP_USER_GROUP,
  bulkDispatchOnly: true,
  graphProposer: getGraphProposer("appGroupUserGroup"),
});

const appAccessStatusPaths = (
  payload: Client.Action.ClientActions["GrantAppsAccess"]["payload"]
) => {
  const res: string[][] = [];

  // index status by both app and user
  for (let params of payload) {
    let appTargetId: string, userTargetId: string;
    if ("appId" in params) {
      appTargetId = params.appId;
    } else {
      appTargetId = params.appGroupId;
    }

    if ("userId" in params) {
      userTargetId = params.userId;
    } else {
      userTargetId = params.userGroupId;
    }

    res.push(
      [appTargetId, params.appRoleId, userTargetId],
      [userTargetId, params.appRoleId, appTargetId]
    );
  }

  return res;
};

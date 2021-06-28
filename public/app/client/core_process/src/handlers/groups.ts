import * as R from "ramda";
import { Client, Api, Model } from "@core/types";
import { clientAction } from "../handler";
import { stripEmptyRecursive, pick } from "@core/lib/utils/object";
import { removeObjectProducers, reorderStatusProducers } from "../lib/status";
import { deleteProposer } from "../lib/graph";
import { getDeleteGroupProducer, getActiveGraph } from "@core/lib/graph";

clientAction<Client.Action.ClientActions["CreateGroupMemberships"]>({
  type: "asyncClientAction",
  actionType: Client.ActionType.CREATE_GROUP_MEMBERSHIPS,
  stateProducer: (draft, { payload }) => {
    for (let path of createMembershipStatusPaths(payload)) {
      draft.isCreatingGroupMemberships = R.assocPath(
        path,
        true,
        draft.isCreatingGroupMemberships
      );

      draft.createGroupMembershipErrors = R.dissocPath(
        path,
        draft.createGroupMembershipErrors
      );
    }

    draft.createGroupMembershipErrors = stripEmptyRecursive(
      draft.createGroupMembershipErrors
    );
  },
  failureStateProducer: (draft, { meta: { rootAction }, payload }) => {
    for (let path of createMembershipStatusPaths(rootAction.payload)) {
      draft.createGroupMembershipErrors = R.assocPath(
        path,
        {
          error: payload,
          payload: rootAction.payload,
        },
        draft.createGroupMembershipErrors
      );
    }
  },
  endStateProducer: (draft, { meta: { rootAction } }) => {
    for (let path of createMembershipStatusPaths(rootAction.payload)) {
      draft.isCreatingGroupMemberships = R.dissocPath(
        path,
        draft.isCreatingGroupMemberships
      );
    }
    draft.isCreatingGroupMemberships = stripEmptyRecursive(
      draft.isCreatingGroupMemberships
    );
  },
  bulkApiDispatcher: true,
  apiActionCreator: async (payload) => ({
    action: {
      type: Api.ActionType.CREATE_GROUP_MEMBERSHIP,
      payload: pick(["groupId", "objectId", "orderIndex"], payload),
    },
  }),
});

clientAction<Api.Action.RequestActions["CreateGroupMembership"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.CREATE_GROUP_MEMBERSHIP,
  bulkDispatchOnly: true,
  graphProposer: ({ payload: { groupId, objectId, orderIndex } }) => (
    graphDraft
  ) => {
    const now = Date.now(),
      proposalId = [groupId, objectId].join("|"),
      group = graphDraft[groupId] as Model.Group;

    graphDraft[proposalId] = {
      type: "groupMembership",
      id: proposalId,
      groupId,
      objectId,
      orderIndex: group.objectType == "block" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    };
  },
});

clientAction<
  Api.Action.RequestActions["CreateGroup"],
  Api.Net.ApiResultTypes["CreateGroup"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.CREATE_GROUP,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  stateProducer: (draft, { payload: { objectType } }) => {
    draft.isCreatingGroup[objectType] = true;
    delete draft.createGroupErrors[objectType];
  },
  failureStateProducer: (
    draft,
    {
      meta: {
        rootAction: {
          payload: { objectType },
        },
      },
      payload,
    }
  ) => {
    draft.createGroupErrors[objectType] = payload;
  },
  endStateProducer: (
    draft,
    {
      meta: {
        rootAction: {
          payload: { objectType },
        },
      },
    }
  ) => {
    delete draft.isCreatingGroup[objectType];
  },
});

clientAction<
  Api.Action.RequestActions["DeleteGroup"],
  Api.Net.ApiResultTypes["DeleteGroup"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.DELETE_GROUP,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
  graphProposer: ({ payload: { id } }) =>
    getDeleteGroupProducer(id, Date.now()),
});

clientAction<
  Api.Action.RequestActions["DeleteGroupMembership"],
  Api.Net.ApiResultTypes["DeleteGroupMembership"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.DELETE_GROUP_MEMBERSHIP,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
  graphProposer: deleteProposer,
});

clientAction<
  Api.Action.RequestActions["DeleteAppUserGroup"],
  Api.Net.ApiResultTypes["DeleteAppUserGroup"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.DELETE_APP_USER_GROUP,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
  graphProposer: deleteProposer,
});

clientAction<
  Api.Action.RequestActions["DeleteAppGroupUser"],
  Api.Net.ApiResultTypes["DeleteAppGroupUser"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.DELETE_APP_GROUP_USER,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
  graphProposer: deleteProposer,
});

clientAction<
  Api.Action.RequestActions["DeleteAppGroupUserGroup"],
  Api.Net.ApiResultTypes["DeleteAppGroupUserGroup"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.DELETE_APP_GROUP_USER_GROUP,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
  graphProposer: deleteProposer,
});

clientAction<
  Api.Action.RequestActions["DeleteAppBlockGroup"],
  Api.Net.ApiResultTypes["DeleteAppBlockGroup"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.DELETE_APP_BLOCK_GROUP,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
  graphProposer: deleteProposer,
});

clientAction<
  Api.Action.RequestActions["DeleteAppGroupBlock"],
  Api.Net.ApiResultTypes["DeleteAppGroupBlock"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.DELETE_APP_GROUP_BLOCK,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
  graphProposer: deleteProposer,
});

clientAction<
  Api.Action.RequestActions["DeleteAppGroupBlockGroup"],
  Api.Net.ApiResultTypes["DeleteAppGroupBlockGroup"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.DELETE_APP_GROUP_BLOCK_GROUP,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...removeObjectProducers,
  graphProposer: deleteProposer,
});

clientAction<
  Api.Action.RequestActions["ReorderAppBlockGroups"],
  Api.Net.ApiResultTypes["ReorderAppBlockGroups"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.REORDER_APP_BLOCK_GROUPS,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...reorderStatusProducers("appBlockGroup"),
});

clientAction<
  Api.Action.RequestActions["ReorderAppGroupBlocks"],
  Api.Net.ApiResultTypes["ReorderAppGroupBlocks"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.REORDER_APP_GROUP_BLOCKS,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...reorderStatusProducers("appGroupBlock"),
});

clientAction<
  Api.Action.RequestActions["ReorderAppGroupBlockGroups"],
  Api.Net.ApiResultTypes["ReorderAppGroupBlockGroups"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.REORDER_APP_GROUP_BLOCK_GROUPS,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...reorderStatusProducers("appGroupBlockGroup"),
});

clientAction<
  Api.Action.RequestActions["ReorderGroupMemberships"],
  Api.Net.ApiResultTypes["ReorderGroupMemberships"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.REORDER_GROUP_MEMBERSHIPS,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...reorderStatusProducers("groupMembership"),
});

const createMembershipStatusPaths = (
  payload: Client.Action.ClientActions["CreateGroupMemberships"]["payload"]
) => {
  const res: string[][] = [];

  for (let { groupId, objectId } of payload) {
    res.push([groupId, objectId], [objectId, groupId]);
  }

  return res;
};

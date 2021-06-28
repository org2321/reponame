import { getCurrentEncryptedKeys } from "../graph/current_encrypted_keys";
import { Client, Model } from "../../types";
import { parseUserEncryptedKeyOrBlobComposite } from "../blob";
import { Draft } from "immer";
import { authz } from "../graph";

export const clearOrphanedBlobsProducer = (
  draft: Draft<Client.PartialAccountState>,
  currentUserId: string,
  currentDeviceId: string
): void => {
  const currentUserEncryptedKeys = getCurrentEncryptedKeys(
    draft.graph,
    {
      userIds: new Set([currentUserId]),
      deviceIds: new Set([currentDeviceId]),
      envParentIds: "all",
    },
    Date.now()
  ).users?.[currentUserId]?.[currentDeviceId];

  for (let composite in draft.envs) {
    const { environmentId } = parseUserEncryptedKeyOrBlobComposite(composite);
    if (draft.graph[environmentId]) {
      const { envParentId } = draft.graph[environmentId] as Model.Environment,
        blob =
          currentUserEncryptedKeys?.[envParentId]?.environments?.[
            environmentId
          ];
      if (!blob || !(blob.env || blob.meta || blob.inherits)) {
        delete draft.envs[composite];
      }
    } else {
      const [envParentId, localsUserId] = environmentId.split("|"),
        blob = currentUserEncryptedKeys?.[envParentId]?.locals?.[localsUserId];
      if (draft.graph[envParentId]) {
        if (!blob || !blob.env) {
          delete draft.envs[composite];
        }
      } else {
        delete draft.envs[composite];
      }
    }
  }

  for (let envParentId in draft.envsFetchedAt) {
    if (draft.graph[envParentId]) {
      if (!currentUserEncryptedKeys?.[envParentId]) {
        delete draft.envsFetchedAt[envParentId];
      }
    } else {
      delete draft.envsFetchedAt[envParentId];
    }
  }

  for (let environmentId in draft.changesets) {
    if (draft.graph[environmentId]) {
      const { envParentId } = draft.graph[environmentId] as Model.Environment,
        blob =
          currentUserEncryptedKeys?.[envParentId]?.environments?.[
            environmentId
          ];
      if (!blob || !blob.changesets) {
        delete draft.changesets[environmentId];
      }
    } else {
      const [envParentId, localsUserId] = environmentId.split("|"),
        blob = currentUserEncryptedKeys?.[envParentId]?.locals?.[localsUserId];
      if (draft.graph[envParentId]) {
        if (!blob || !blob.env) {
          delete draft.changesets[environmentId];
        }
      } else {
        delete draft.changesets[environmentId];
      }
    }
  }

  for (let envParentId in draft.changesetsFetchedAt) {
    if (draft.graph[envParentId]) {
      if (!currentUserEncryptedKeys?.[envParentId]) {
        delete draft.changesetsFetchedAt[envParentId];
      }
    } else {
      delete draft.changesetsFetchedAt[envParentId];
    }
  }
};

export const clearOrphanedEnvUpdatesProducer = (
  draft: Draft<Client.PartialAccountState>,
  currentUserId: string
): void => {
  draft.pendingEnvUpdates = draft.pendingEnvUpdates.filter((update) => {
    const envParent = draft.graph[update.meta.envParentId];
    if (!envParent) {
      return false;
    }

    const environment = draft.graph[update.meta.environmentId];
    if (environment) {
      if (!authz.canUpdateEnv(draft.graph, currentUserId, environment.id)) {
        return false;
      }
    } else {
      const [envParentId, localsUserId] = update.meta.environmentId.split("|");
      if (
        !envParentId ||
        !localsUserId ||
        !draft.graph[envParentId] ||
        !draft.graph[localsUserId]
      ) {
        return false;
      }

      if (
        !authz.canUpdateLocals(
          draft.graph,
          currentUserId,
          envParentId,
          localsUserId
        )
      ) {
        return false;
      }
    }

    return true;
  });
};

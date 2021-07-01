import stableStringify from "fast-json-stable-stringify";
import {
  getActiveOrgGraphObjects,
  getDeletedOrgGraphObjects,
  graphKey,
} from "./db";
import { Graph, Rbac, Model, Api, Auth } from "@core/types";
import { env } from "./env";
import { verifySignedLicense, getOrgBillingId, BILLING_TIERS } from "./billing";
import * as R from "ramda";
import { pick } from "@core/lib/utils/pick";
import produce from "immer";
import {
  graphTypes,
  getUserGraph,
  getOrgAccessSet,
  getOrgUserDevicesByUserId,
  getAppUserGrantsByUserId,
  getLocalKeysByUserId,
  getGroupMembershipsByObjectId,
  getActiveRecoveryKeysByUserId,
  getActiveOrExpiredInvitesByInvitedByUserId,
  getActiveOrExpiredDeviceGrantsByGrantedByUserId,
  getActiveOrExpiredInvitesByInviteeId,
  getActiveOrExpiredDeviceGrantsByGranteeId,
  getUserIsImmediatelyDeletable,
  getDeviceIsImmediatelyDeletable,
  deleteGraphObjects,
  getEnvParentPermissions,
  getOrgPermissions,
  getActiveGraph,
} from "@core/lib/graph";
import { v4 as uuid } from "uuid";
import { objectDifference } from "@core/lib/utils/object";
import { log } from "@core/lib/utils/logger";
import { WritableDraft } from "immer/dist/internal";

export const getOrgGraph = async (
    orgId: string,
    readOpts: Api.Db.DbReadOpts = {}
  ): Promise<Api.Graph.OrgGraph> => {
    // query for active graph items, add to graph
    const graphObjects = await getActiveOrgGraphObjects(orgId, readOpts);
    return R.indexBy(R.prop("id"), graphObjects);
  },
  getDeletedOrgGraph = async (
    orgId: string,
    startsAt: number,
    endsAt?: number
  ): Promise<Api.Graph.OrgGraph> => {
    const graphObjects = await getDeletedOrgGraphObjects(
      orgId,
      startsAt,
      endsAt
    );
    return R.indexBy(R.prop("id"), graphObjects);
  },
  getApiUserGraph = (
    orgGraph: Api.Graph.OrgGraph,
    orgId: string,
    userId: string,
    deviceId: string | undefined,
    now: number,
    includeDeleted = false
  ) => {
    let userGraph = getUserGraph(orgGraph, userId, deviceId, includeDeleted);
    const org = orgGraph[orgId] as Api.Db.Org;

    const license = verifySignedLicense(org.id, org.signedLicense, now, false);

    const billingId = getOrgBillingId(org.id);

    if (env.IS_CLOUD_ENVKEY) {
      return {
        ...userGraph,
        [org.id]: {
          ...org,
          billingId,
          billingTiers: BILLING_TIERS,
        },
        [license.id]: license,
      };
    }

    if (env.IS_SELF_HOSTED_ENVKEY) {
      return {
        ...userGraph,
        [org.id]: {
          ...org,
          billingId,
          billingTiers: BILLING_TIERS,
          selfHostedVersions: {
            api: env.API_VERSION_NUMBER!,
            infra: env.INFRA_VERSION_NUMBER!,
          },
        },
        [license.id]: license,
      };
    }

    // community
    return {
      ...userGraph,
      [org.id]: {
        ...org,
        billingId,
        billingTiers: [],
      },
      [license.id]: license,
    };
  },
  getAccessUpdated = (
    previousGraph: Graph.Graph,
    nextGraph: Graph.Graph,
    scope: Rbac.OrgAccessScope
  ): Rbac.OrgAccessUpdated => {
    const nextSet = getOrgAccessSet(getActiveGraph(nextGraph), scope);
    const prevSet = getOrgAccessSet(previousGraph, scope);
    const granted = objectDifference(nextSet, prevSet);
    const removed = objectDifference(prevSet, nextSet);

    return { granted, removed };
  },
  setEnvsUpdatedFields = (
    auth: Auth.UserAuthContext,
    orgGraph: Api.Graph.OrgGraph,
    blobs: Api.Net.EnvParams["blobs"],
    now: number
  ) => {
    const encryptedById =
      auth.type == "tokenAuthContext" ? auth.orgUserDevice.id : auth.user.id;
    const updatingEnvironmentIds = new Set<string>();

    const updatedGraph = produce(orgGraph, (draft) => {
      for (let envParentId in blobs) {
        const envParent = draft[envParentId] as Model.App | Model.Block;
        const { environments, locals } = blobs[envParentId];

        for (let environmentId in environments) {
          updatingEnvironmentIds.add(environmentId);

          const environment = draft[environmentId] as Model.Environment;

          environment.envUpdatedAt = now;
          environment.encryptedById = encryptedById;
          envParent.envsUpdatedAt = now;
          envParent.envsOrLocalsUpdatedAt = now;
        }

        for (let localsUserId in locals) {
          envParent.localsUpdatedAtByUserId[localsUserId] = now;
          envParent.localsUpdatedAt = now;
          envParent.envsOrLocalsUpdatedAt = now;
          envParent.localsEncryptedBy[localsUserId] = encryptedById;
        }
      }
    });

    return {
      updatedGraph,
      updatingEnvironmentIds,
    };
  },
  getGraphTransactionItems = (
    previousGraph: Api.Graph.OrgGraph,
    nextGraph: Api.Graph.OrgGraph,
    now: number
  ) => {
    const transactionItems: Api.Db.ObjectTransactionItems = {},
      toPut: { [id: string]: Api.Graph.GraphObject } = {},
      toDelete: Api.Graph.GraphObject[] = [];

    // compare each item in graph, checking equality / newly created / deleted
    for (let id in nextGraph) {
      const previous = previousGraph[id],
        next = nextGraph[id];

      if (!previous || stableStringify(previous) != stableStringify(next)) {
        if (next.deletedAt) {
          toDelete.push({
            ...next,
            updatedAt: now,
          });
        } else {
          toPut[next.id] = {
            ...next,
            updatedAt: now,
          };
        }
      }
    }

    for (let obj of toDelete) {
      if (obj.id in toPut) {
        delete toPut[obj.id];
      }

      if (!transactionItems.softDeleteKeys) {
        transactionItems.softDeleteKeys = [];
      }
      transactionItems.softDeleteKeys.push(pick(["pkey", "skey"], obj));
    }

    for (let id in toPut) {
      const obj = toPut[id];
      if (!transactionItems.puts) {
        transactionItems.puts = [];
      }
      transactionItems.puts.push(obj);
    }

    return transactionItems;
  },
  deleteUser = (
    orgGraph: Api.Graph.OrgGraph,
    userId: string,
    auth: Auth.DefaultAuthContext | Auth.ProvisioningBearerAuthContext,
    now: number
  ): Api.Graph.OrgGraph => {
    const target = orgGraph[userId] as Api.Db.OrgUser | Api.Db.CliUser,
      byType = graphTypes(orgGraph),
      orgUserDevices = getOrgUserDevicesByUserId(orgGraph)[userId] ?? [],
      appUserGrants = getAppUserGrantsByUserId(orgGraph)[userId] ?? [],
      localKeys = getLocalKeysByUserId(orgGraph)[userId] ?? [],
      localKeyIds = localKeys.map(R.prop("id")),
      localKeyIdsSet = new Set(localKeyIds),
      generatedEnvkeys = byType.generatedEnvkeys.filter(({ keyableParentId }) =>
        localKeyIdsSet.has(keyableParentId)
      ),
      groupMemberships = getGroupMembershipsByObjectId(orgGraph)[userId] ?? [],
      appGroupUsers = byType.appGroupUsers.filter(R.propEq("userId", userId)),
      recoveryKey = getActiveRecoveryKeysByUserId(orgGraph)[userId],
      pendingOrExpiredInviterInvites =
        getActiveOrExpiredInvitesByInvitedByUserId(orgGraph)[userId] ?? [],
      pendingInviterOrgUserIds = pendingOrExpiredInviterInvites
        .map(R.prop("inviteeId"))
        .filter((inviteeId) => {
          const invitee = orgGraph[inviteeId] as Model.OrgUser;
          return !invitee.inviteAcceptedAt;
        }),
      pendingOrExpiredGranterDeviceGrants =
        getActiveOrExpiredDeviceGrantsByGrantedByUserId(orgGraph)[userId] ?? [];

    let deleteIds: string[] = (
      [
        appUserGrants,
        generatedEnvkeys,
        groupMemberships,
        appGroupUsers,
        recoveryKey ? [recoveryKey] : [],
        pendingOrExpiredInviterInvites,
        pendingOrExpiredGranterDeviceGrants,
      ] as Api.Graph.GraphObject[][]
    ).flatMap((objects) => objects.map(R.prop("id")));

    deleteIds = deleteIds.concat(pendingInviterOrgUserIds);

    let updatedGraph = produce(orgGraph, (draft) => {
      const draftsByType = graphTypes(draft);

      // clear out localsUpdatedAtByUserId / localsEncryptedBy entries
      const { apps: appDrafts, blocks: blockDrafts } = draftsByType;
      for (let envParentDrafts of [appDrafts, blockDrafts]) {
        for (let envParentDraft of envParentDrafts) {
          delete envParentDraft.localsUpdatedAtByUserId[userId];
          delete envParentDraft.localsEncryptedBy[userId];
        }
      }

      // clear out any pending rootPubkeyReplacements for user + user's local keys
      const rootPubkeyReplacementDrafts =
        draftsByType.rootPubkeyReplacements as Api.Db.RootPubkeyReplacement[];
      for (let replacementDraft of rootPubkeyReplacementDrafts) {
        for (let objs of [orgUserDevices, generatedEnvkeys]) {
          for (let { id } of objs) {
            delete replacementDraft.processedAtById[id];
          }
        }
        const replacementProcessedAll = R.all(
          Boolean,
          Object.values(replacementDraft.processedAtById)
        );
        if (replacementProcessedAll) {
          deleteIds.push(replacementDraft.id);
        }
      }
    });

    const canImmediatelyDelete = getUserIsImmediatelyDeletable(
      orgGraph,
      userId
    );

    if (canImmediatelyDelete) {
      deleteIds.push(userId);

      for (let { id } of orgUserDevices) {
        deleteIds.push(id);
      }

      const invites =
          getActiveOrExpiredInvitesByInviteeId(orgGraph)[userId] ?? [],
        deviceGrants =
          getActiveOrExpiredDeviceGrantsByGranteeId(orgGraph)[userId] ?? [];

      for (let objs of [invites, deviceGrants]) {
        for (let { id } of objs) {
          deleteIds.push(id);
        }
      }
    } else {
      updatedGraph = produce(updatedGraph, (draft) => {
        (draft[target.id] as Api.Db.OrgUser | Api.Db.CliUser).deactivatedAt =
          now;

        if (target.type == "cliUser") {
          const pubkeyRevocationRequest = getPubkeyRevocationRequest(
            auth,
            target,
            now
          );

          draft[pubkeyRevocationRequest.id] = pubkeyRevocationRequest;
        } else {
          for (let orgUserDevice of orgUserDevices) {
            (draft[orgUserDevice.id] as Api.Db.OrgUserDevice).deactivatedAt =
              now;

            const pubkeyRevocationRequest = getPubkeyRevocationRequest(
              auth,
              orgUserDevice,
              now
            );

            draft[pubkeyRevocationRequest.id] = pubkeyRevocationRequest;
          }
        }
      });
    }

    deleteIds = deleteIds.concat(localKeyIds);
    updatedGraph = deleteGraphObjects(updatedGraph, deleteIds, now);

    return updatedGraph;
  },
  deleteDevice = (
    orgGraph: Api.Graph.OrgGraph,
    deviceId: string,
    auth: Auth.DefaultAuthContext,
    now: number
  ): Api.Graph.OrgGraph => {
    const orgUserDevice = orgGraph[deviceId] as Api.Db.OrgUserDevice;
    let deleteIds: string[] = [];

    let updatedGraph = produce(orgGraph, (draft) => {
      const draftsByType = graphTypes(draft);

      // clear out any pending rootPubkeyReplacements for this device
      const rootPubkeyReplacementDrafts =
        draftsByType.rootPubkeyReplacements as Api.Db.RootPubkeyReplacement[];
      for (let replacementDraft of rootPubkeyReplacementDrafts) {
        delete replacementDraft.processedAtById[deviceId];
        const replacementProcessedAll = R.all(
          Boolean,
          Object.values(replacementDraft.processedAtById)
        );
        if (replacementProcessedAll) {
          deleteIds.push(replacementDraft.id);
        }
      }
    });

    const canImmediatelyDelete = getDeviceIsImmediatelyDeletable(
      orgGraph,
      deviceId
    );

    if (canImmediatelyDelete) {
      deleteIds.push(deviceId);
    } else {
      updatedGraph = produce(updatedGraph, (draft) => {
        (draft[orgUserDevice.id] as Api.Db.OrgUserDevice).deactivatedAt = now;

        const pubkeyRevocationRequest = getPubkeyRevocationRequest(
          auth,
          orgUserDevice,
          now
        );
        draft[pubkeyRevocationRequest.id] = pubkeyRevocationRequest;
      });
    }

    if (deleteIds.length > 0) {
      updatedGraph = deleteGraphObjects(updatedGraph, deleteIds, now);
    }

    return updatedGraph;
  },
  clearOrphanedLocals = (
    orgGraph: Api.Graph.OrgGraph
  ): [Api.Graph.OrgGraph, Api.Db.ObjectTransactionItems] => {
    // delete blobs and clear localsUpdatedAt for any users that previously had access and no longer do
    const hardDeleteEncryptedBlobParams: Api.Db.ObjectTransactionItems["hardDeleteEncryptedBlobParams"] =
      [];

    const active = getActiveGraph(orgGraph);
    const { apps, blocks, org } = graphTypes(orgGraph);

    const updatedOrgGraph = produce(orgGraph, (draft) => {
      for (let envParent of (apps as Model.EnvParent[]).concat(blocks)) {
        if (envParent.deletedAt) {
          continue;
        }

        for (let localsUserId in envParent.localsUpdatedAtByUserId) {
          const localsUser = active[localsUserId] as
            | Model.OrgUser
            | Model.CliUser
            | undefined;

          let shouldClear = false;

          if (localsUser) {
            const orgPermissions = getOrgPermissions(
              active,
              localsUser.orgRoleId
            );

            const envParentPermissions = getEnvParentPermissions(
              active,
              envParent.id,
              localsUserId
            );

            if (
              !orgPermissions.has("blocks_read_all") &&
              !envParentPermissions.has("app_read_own_locals")
            ) {
              shouldClear = true;
            }
          } else {
            shouldClear = true;
          }

          if (shouldClear) {
            const envParentDraft = draft[
              envParent.id
            ] as WritableDraft<Model.EnvParent>;
            delete envParentDraft.localsUpdatedAtByUserId[localsUserId];
            delete envParentDraft.localsEncryptedBy[localsUserId];

            hardDeleteEncryptedBlobParams.push({
              orgId: org.id,
              envParentId: envParent.id,
              blobType: "env",
              environmentId: [envParent.id, localsUserId].join("|"),
            });
          }
        }
      }
    });

    return [updatedOrgGraph, { hardDeleteEncryptedBlobParams }];
  };

const getPubkeyRevocationRequest = (
  auth: Auth.DefaultAuthContext | Auth.ProvisioningBearerAuthContext,
  revocationTarget: Model.OrgUserDevice | Model.CliUser,
  now: number
) => {
  const pubkeyRevocationRequestId = uuid(),
    pubkeyRevocationRequest: Api.Db.PubkeyRevocationRequest = {
      type: "pubkeyRevocationRequest",
      id: pubkeyRevocationRequestId,
      ...graphKey(
        auth.org.id,
        "pubkeyRevocationRequest",
        pubkeyRevocationRequestId
      ),
      targetId: revocationTarget.id,
      // OrgUser.id or ProvisioningProvider.id. Informational prop only (?)
      creatorId:
        "provisioningProvider" in auth
          ? auth.provisioningProvider.id
          : auth.user.id,
      excludeFromDeletedGraph: true,
      createdAt: now,
      updatedAt: now,
    };
  return pubkeyRevocationRequest;
};

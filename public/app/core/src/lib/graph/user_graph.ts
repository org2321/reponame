import * as R from "ramda";
import { Api, Client } from "../../types";
import { getPermittedGraphObjects } from ".";
import { pick } from "../utils/object";

export const getUserGraph = (
    graph: Api.Graph.OrgGraph,
    userId: string,
    deviceId: string | undefined,
    includeDeleted = false
  ): Client.Graph.UserGraph => {
    const userGraph = R.indexBy(
      R.prop("id"),
      (
        R.flatten(
          Object.values(
            getPermittedGraphObjects(graph, userId, deviceId, includeDeleted)
          )
        ) as Api.Graph.GraphObject[]
      ).map(orgGraphObjectToUserGraphObject)
    );

    return userGraph;
  },
  orgGraphObjectToUserGraphObject = (
    obj: Api.Graph.GraphObject
  ): Client.Graph.UserGraphObject => {
    const baseProps = <const>[
      "type",
      "id",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ];

    switch (obj.type) {
      case "org":
        return pick(
          [
            ...baseProps,
            "name",
            "creatorId",
            "settings",
            "rbacUpdatedAt",
            "graphUpdatedAt",
            "selfHostedVersions",
            "selfHostedUpgradeStatus",
            "totalStorageBytes",
            "apiCallsThisMonth",
            "dataTransferBytesThisMonth",
          ],
          obj
        );

      case "orgUser":
        return pick(
          [
            ...baseProps,
            "email",
            "uid",
            "provider",
            "externalAuthProviderId",
            "firstName",
            "lastName",
            "invitedById",
            "isCreator",
            "inviteAcceptedAt",
            "orgRoleId",
            "deactivatedAt",
            "orgRoleUpdatedAt",
            "scim",
          ],
          obj
        );

      case "orgUserDevice":
        const orgUserDeviceProps = <const>[
          ...baseProps,
          "name",
          "pubkey",
          "pubkeyId",
          "pubkeyUpdatedAt",
          "userId",
          "approvedAt",
          "approvedByType",
          "deactivatedAt",
          "isRoot",
        ];

        if (obj.approvedByType == "invite") {
          return pick([...orgUserDeviceProps, "inviteId"], obj);
        } else if (obj.approvedByType == "deviceGrant") {
          return pick([...orgUserDeviceProps, "deviceGrantId"], obj);
        } else if (obj.approvedByType == "recoveryKey") {
          return pick([...orgUserDeviceProps, "recoveryKeyId"], obj);
        }

        return pick([...orgUserDeviceProps], obj);

      case "cliUser":
        return pick(
          [
            ...baseProps,
            "orgRoleId",
            "name",
            "pubkey",
            "pubkeyId",
            "pubkeyUpdatedAt",
            "creatorId",
            "creatorDeviceId",
            "deactivatedAt",
            "signedById",
            "orgRoleUpdatedAt",
          ],
          obj
        );

      case "recoveryKey":
        return pick(
          [
            ...baseProps,
            "userId",
            "creatorDeviceId",
            "signedById",
            "pubkey",
            "pubkeyId",
            "pubkeyUpdatedAt",
            "redeemedAt",
          ],
          obj
        );

      case "invite":
        return pick(
          [
            ...baseProps,
            "inviteeId",
            "pubkey",
            "pubkeyId",
            "pubkeyUpdatedAt",
            "acceptedAt",
            "expiresAt",
            "invitedByUserId",
            "invitedByDeviceId",
            "signedById",
          ],
          obj
        );

      case "deviceGrant":
        return pick(
          [
            ...baseProps,
            "granteeId",
            "pubkey",
            "pubkeyId",
            "pubkeyUpdatedAt",
            "deviceId",
            "grantedByUserId",
            "grantedByDeviceId",
            "acceptedAt",
            "expiresAt",
            "signedById",
          ],
          obj
        );

      case "app":
        return pick(
          [
            ...baseProps,
            "name",
            "localsUpdatedAtByUserId",
            "localsUpdatedAt",
            "localsEncryptedBy",
            "envsUpdatedAt",
            "envsOrLocalsUpdatedAt",
            "localsReencryptionRequiredAt",
            "settings",
          ],
          obj
        );

      case "block":
        return pick(
          [
            ...baseProps,
            "name",
            "localsUpdatedAtByUserId",
            "localsEncryptedBy",
            "localsUpdatedAt",
            "envsUpdatedAt",
            "envsOrLocalsUpdatedAt",
            "localsReencryptionRequiredAt",
            "settings",
          ],
          obj
        );

      case "appUserGrant":
        return pick([...baseProps, "userId", "appId", "appRoleId"], obj);

      case "server":
        return pick(
          [...baseProps, "name", "appId", "environmentId", "undeletable"],
          obj
        );

      case "localKey":
        return pick(
          [
            ...baseProps,
            "name",
            "appId",
            "environmentId",
            "userId",
            "undeletable",
          ],
          obj
        );

      case "appBlock":
        return pick([...baseProps, "appId", "blockId", "orderIndex"], obj);

      case "environment":
        const environmentProps = <const>[
          ...baseProps,
          "envParentId",
          "environmentRoleId",
          "isSub",
          "envUpdatedAt",
          "encryptedById",
          "reencryptionRequiredAt",
        ];

        return obj.isSub
          ? pick([...environmentProps, "subName", "parentEnvironmentId"], obj)
          : pick([...environmentProps, "settings"], obj);

      case "variableGroup":
        return pick(
          [...baseProps, "envParentId", "subEnvironmentId", "name"],
          obj
        );

      case "includedAppRole":
        return pick([...baseProps, "appId", "appRoleId"], obj);

      case "group":
        return pick(
          [...baseProps, "objectType", "name", "membershipsUpdatedAt"],
          obj
        );

      case "groupMembership":
        return pick([...baseProps, "groupId", "objectId", "orderIndex"], obj);

      case "appUserGroup":
        return pick([...baseProps, "appId", "userGroupId", "appRoleId"], obj);

      case "appGroupUserGroup":
        return pick(
          [...baseProps, "appGroupId", "userGroupId", "appRoleId"],
          obj
        );

      case "appGroupUser":
        return pick([...baseProps, "appGroupId", "userId", "appRoleId"], obj);

      case "appGroupBlock":
        return pick([...baseProps, "blockId", "appGroupId", "orderIndex"], obj);

      case "appBlockGroup":
        return pick([...baseProps, "blockGroupId", "appId", "orderIndex"], obj);

      case "appGroupBlockGroup":
        return pick(
          [...baseProps, "appGroupId", "blockGroupId", "orderIndex"],
          obj
        );

      case "generatedEnvkey":
        return pick(
          [
            ...baseProps,
            "appId",
            "keyableParentId",
            "keyableParentType",
            "envkeyShort",
            "envkeyIdPartHash",
            "pubkey",
            "pubkeyId",
            "pubkeyUpdatedAt",
            "creatorId",
            "creatorDeviceId",
            "signedById",
            "blobsUpdatedAt",
            "environmentId",
          ],
          obj
        );

      case "orgRole":
        return {
          ...pick(
            [
              ...baseProps,
              "name",
              "description",
              "autoAppRoleId",
              "canHaveCliUsers",
              "orderIndex",
            ],
            obj
          ),
          isDefault: obj.isDefault as any,
          defaultName: obj.defaultName as any,
          extendsRoleId: obj.extendsRoleId as any,
          permissions: obj.permissions as any,
          addPermissions: obj.addPermissions as any,
          removePermissions: obj.removePermissions as any,
          canManageAllOrgRoles: obj.canManageAllOrgRoles as any,
          canManageOrgRoleIds: obj.canManageOrgRoleIds as any,
          canInviteAllOrgRoles: obj.canInviteAllOrgRoles as any,
          canInviteOrgRoleIds: obj.canInviteOrgRoleIds as any,
          defaultDescription: obj.defaultDescription as any,
        };

      case "appRole":
        return {
          ...pick(
            [
              ...baseProps,
              "name",
              "description",
              "defaultAllApps",
              "canHaveCliUsers",
              "hasFullEnvironmentPermissions",
              "orderIndex",
            ],
            obj
          ),
          isDefault: obj.isDefault as any,
          defaultName: obj.defaultName as any,
          extendsRoleId: obj.extendsRoleId as any,
          permissions: obj.permissions as any,
          addPermissions: obj.addPermissions as any,
          removePermissions: obj.removePermissions as any,
          canInviteAppRoleIds: obj.canInviteAppRoleIds as any,
          canManageAppRoleIds: obj.canManageAppRoleIds as any,
          defaultDescription: obj.defaultDescription as any,
        };

      case "environmentRole":
        const environmentRoleProps = <const>[
          ...baseProps,
          "name",
          "description",
          "isDefault",
          "hasLocalKeys",
          "hasServers",
          "defaultAllApps",
          "defaultAllBlocks",
          "settings",
          "orderIndex",
        ];

        return obj.isDefault
          ? pick(
              [...environmentRoleProps, "defaultName", "defaultDescription"],
              obj
            )
          : pick([...environmentRoleProps], obj);

      case "appRoleEnvironmentRole":
        return pick(
          [...baseProps, "appRoleId", "environmentRoleId", "permissions"],
          obj
        );

      case "pubkeyRevocationRequest":
        return pick([...baseProps, "targetId", "creatorId"], obj);

      case "rootPubkeyReplacement":
        return pick(
          [
            ...baseProps,
            "requestId",
            "creatorId",
            "replacingPubkey",
            "signedReplacingTrustChain",
          ],
          obj
        );

      case "externalAuthProvider":
        if (obj.provider === "saml") {
          return pick(
            [
              ...baseProps,
              "nickname",
              "authMethod",
              "provider",
              "orgId",
              "samlSettingsId",
            ],
            obj
          );
        }
        return pick(
          [...baseProps, "nickname", "authMethod", "provider", "orgId"],
          obj
        );

      case "file":
        return pick(
          [
            ...baseProps,
            "path",
            "envParentId",
            "localsUpdatedAtByUserId",
            "localsEncryptedBy",
            "localsUpdatedAt",
            "envsUpdatedAt",
            "envsUpdatedAtByEnvironmentId",
            "envsEncryptedBy",
            "envsOrLocalsUpdatedAt",
          ],
          obj
        );

      case "scimProvisioningProvider":
        return pick(
          [...baseProps, "orgId", "nickname", "authScheme", "endpointBaseUrl"],
          obj
        );
    }
  };

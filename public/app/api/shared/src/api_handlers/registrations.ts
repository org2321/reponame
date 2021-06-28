import { env } from "../env";
import { apiAction, apiErr } from "../handler";
import { Api, Rbac, Auth } from "@core/types";
import { v4 as uuid } from "uuid";
import { secureRandomAlphanumeric } from "@core/lib/crypto/utils";
import { graphKey, mergeObjectTransactionItems } from "../db";
import * as R from "ramda";
import { verifyEmailToken, verifyExternalAuthSession } from "../auth";
import { getCreateExternalAuthProviderWithTransactionItems } from "../models/external_auth";
import { getAuthTokenKey } from "../models/auth_tokens";
import { pick } from "@core/lib/utils/pick";
import { getOrgKey } from "../models/orgs";
import { getApiUserGraph } from "../graph";
import { getPubkeyHash } from "@core/lib/client";
import { sha256 } from "@core/lib/crypto/utils";

apiAction<
  Api.Action.RequestActions["Register"],
  Api.Net.ApiResultTypes["Register"]
>({
  type: Api.ActionType.REGISTER,
  graphAction: false,
  authenticated: false,
  handler: async ({ payload }, now, requestParams, transactionConn) => {
    const email = payload.user.email.toLowerCase().trim();

    let externalAuthSession: Api.Db.ExternalAuthSession | undefined,
      verifyTokenRes: false | Api.Db.ObjectTransactionItems | undefined;

    if (
      (payload.hostType == "self-hosted" && env.IS_CLOUD_ENVKEY) ||
      (payload.hostType == "cloud" && !env.IS_CLOUD_ENVKEY)
    ) {
      throw await apiErr(transactionConn, "host type mismatch", 400);
    }

    if (payload.provider == "email" && payload.emailVerificationToken) {
      verifyTokenRes = await verifyEmailToken(
        email,
        payload.emailVerificationToken,
        now
      );
      if (!verifyTokenRes) {
        throw await apiErr(
          transactionConn,
          "email verification code invalid",
          401
        );
      }
    } else if (payload.hostType == "cloud" && payload.provider != "email") {
      const verifyExternalAuthSessionRes = await verifyExternalAuthSession(
        payload.externalAuthSessionId
      );

      if (!verifyExternalAuthSessionRes) {
        throw await apiErr(
          transactionConn,
          "external auth session invalid",
          401
        );
      } else {
        externalAuthSession = verifyExternalAuthSessionRes;
      }
    }

    const [userId, orgId, deviceId] = R.times(() => uuid(), 3),
      token = secureRandomAlphanumeric(26),
      environmentRoleIds = R.times(() => uuid(), 3),
      environmentRoles: Api.Db.EnvironmentRole[] = [
        {
          type: "environmentRole",
          id: environmentRoleIds[0],
          ...graphKey(orgId, "environmentRole", environmentRoleIds[0]),
          defaultName: "Development",
          name: "Development",
          defaultDescription: "Default development environment",
          description: "Default development environment",
          isDefault: true,
          hasLocalKeys: true,
          hasServers: true,
          defaultAllApps: true,
          defaultAllBlocks: true,
          settings: { autoCommit: false },
          createdAt: now,
          updatedAt: now,
          orderIndex: 0,
        },
        {
          type: "environmentRole",
          id: environmentRoleIds[1],
          ...graphKey(orgId, "environmentRole", environmentRoleIds[1]),
          defaultName: "Staging",
          name: "Staging",
          defaultDescription: "Default staging environment",
          description: "Default staging environment",
          isDefault: true,
          hasLocalKeys: false,
          hasServers: true,
          defaultAllApps: true,
          defaultAllBlocks: true,
          settings: { autoCommit: false },
          createdAt: now,
          updatedAt: now,
          orderIndex: 1,
        },
        {
          type: "environmentRole",
          id: environmentRoleIds[2],
          ...graphKey(orgId, "environmentRole", environmentRoleIds[2]),
          defaultName: "Production",
          name: "Production",
          defaultDescription: "Default production environment",
          description: "Default production environment",
          isDefault: true,
          hasLocalKeys: false,
          hasServers: true,
          defaultAllApps: true,
          defaultAllBlocks: true,
          settings: { autoCommit: false },
          createdAt: now,
          updatedAt: now,
          orderIndex: 2,
        },
      ],
      [appDevId, appProdId, appAdminId, appOrgAdminId, appOrgOwnerId] = R.times(
        (i) => uuid(),
        5
      ),
      appRoles: Api.Db.AppRole[] = [
        {
          type: "appRole",
          id: appDevId,
          ...graphKey(orgId, "appRole", appDevId),
          defaultName: "Developer",
          name: "Developer",
          defaultDescription:
            "Can view or update development and staging environments.",
          description:
            "Can view or update development and staging environments.",
          isDefault: true,
          hasFullEnvironmentPermissions: false,
          canHaveCliUsers: true,
          canManageAppRoleIds: [],
          canInviteAppRoleIds: [],
          defaultAllApps: true,
          createdAt: now,
          updatedAt: now,
          orderIndex: 4,
        },
        {
          type: "appRole",
          id: appProdId,
          ...graphKey(orgId, "appRole", appProdId),
          defaultName: "DevOps",
          name: "DevOps",
          defaultDescription:
            "Can view or update development, staging, and production environments. Can manage servers.",
          description:
            "Can view or update development, staging, and production environments. Can manage servers.",
          isDefault: true,
          hasFullEnvironmentPermissions: false,
          canHaveCliUsers: true,
          canManageAppRoleIds: [],
          canInviteAppRoleIds: [],
          defaultAllApps: true,
          createdAt: now,
          updatedAt: now,
          orderIndex: 3,
        },
        {
          type: "appRole",
          id: appAdminId,
          ...graphKey(orgId, "appRole", appAdminId),
          defaultName: "Admin",
          name: "Admin",
          defaultDescription:
            "Can view and update all environments. Can manage servers, invite users, and update app settings.",
          description:
            "Can view and update all environments. Can manage servers, invite users, and update app settings.",
          isDefault: true,
          canHaveCliUsers: true,
          canManageAppRoleIds: [appDevId, appProdId],
          canInviteAppRoleIds: [appDevId, appProdId, appAdminId],
          defaultAllApps: true,
          hasFullEnvironmentPermissions: true,
          createdAt: now,
          updatedAt: now,
          orderIndex: 2,
        },

        {
          type: "appRole",
          id: appOrgAdminId,
          ...graphKey(orgId, "appRole", appOrgAdminId),
          defaultName: "Org Admin",
          name: "Org Admin",
          defaultDescription:
            "Can view and update all environments. Can manage servers, invite users, and update app settings.",
          description:
            "Can view and update all environments. Can manage servers, invite users, and update app settings.",
          isDefault: true,
          canHaveCliUsers: true,
          canManageAppRoleIds: [appDevId, appProdId, appAdminId],
          canInviteAppRoleIds: [appDevId, appProdId, appAdminId],
          hasFullEnvironmentPermissions: true,
          defaultAllApps: true,
          createdAt: now,
          updatedAt: now,
          orderIndex: 1,
        },

        {
          type: "appRole",
          id: appOrgOwnerId,
          ...graphKey(orgId, "appRole", appOrgOwnerId),
          defaultName: "Org Owner",
          name: "Org Owner",
          defaultDescription:
            "Can view and update all environments. Can manage servers, invite users, and update app settings.",
          description:
            "Can view and update all environments. Can manage servers, invite users, and update app settings.",
          isDefault: true,
          canHaveCliUsers: true,
          canManageAppRoleIds: [appDevId, appProdId, appAdminId],
          canInviteAppRoleIds: [appDevId, appProdId, appAdminId],
          hasFullEnvironmentPermissions: true,
          defaultAllApps: true,
          createdAt: now,
          updatedAt: now,
          orderIndex: 0,
        },
      ],
      [basicUserId, orgAdminId, orgOwnerId] = R.times((i) => uuid(), 3),
      orgRoles: Api.Db.OrgRole[] = [
        {
          type: "orgRole",
          id: basicUserId,
          ...graphKey(orgId, "orgRole", basicUserId),
          defaultName: "Basic User",
          name: "Basic User",
          defaultDescription: "Permissions are granted on a per-app basis",
          description: "Permissions are granted on a per-app basis",
          isDefault: true,
          canHaveCliUsers: true,
          canManageOrgRoleIds: [],
          canInviteOrgRoleIds: [basicUserId],
          createdAt: now,
          updatedAt: now,
          orderIndex: 2,
        },
        {
          type: "orgRole",
          id: orgAdminId,
          ...graphKey(orgId, "orgRole", orgAdminId),
          defaultName: "Org Admin",
          name: "Org Admin",
          defaultDescription:
            "Admin access to all apps and blocks. Can manage users and groups at org level. Can manage app and environment roles. Can manage org settings. Can read org logs.",
          description:
            "Admin access to all apps and blocks. Can manage users and groups at org level. Can manage app and environment roles. Can manage org settings. Can read org logs.",
          isDefault: true,
          canManageOrgRoleIds: [basicUserId],
          canInviteOrgRoleIds: [basicUserId, orgAdminId],
          canHaveCliUsers: true,
          autoAppRoleId: appOrgAdminId,
          createdAt: now,
          updatedAt: now,
          orderIndex: 1,
        },
        {
          type: "orgRole",
          id: orgOwnerId,
          ...graphKey(orgId, "orgRole", orgOwnerId),
          defaultName: "Org Owner",
          name: "Org Owner",
          defaultDescription:
            "Total access. Can manage billing, hosting, and settings, along with everything else.",
          description:
            "Total access. Can manage billing, hosting, and settings, along with everything else.",
          isDefault: true,
          canManageAllOrgRoles: true,
          canInviteAllOrgRoles: true,
          canHaveCliUsers: false,
          autoAppRoleId: appOrgOwnerId,
          createdAt: now,
          updatedAt: now,
          orderIndex: 0,
        },
      ],
      appRoleEnvironmentRoles: Api.Db.AppRoleEnvironmentRole[] = appRoles
        .filter(R.complement(R.prop("hasFullEnvironmentPermissions")))
        .flatMap((appRole) => {
          return environmentRoles.map((environmentRole) => {
            const id = uuid();
            return {
              type: <const>"appRoleEnvironmentRole",
              id,
              ...graphKey(orgId, "appRoleEnvironmentRole", id),
              appRoleId: appRole.id,
              environmentRoleId: environmentRole.id,
              permissions:
                Rbac.ENVIRONMENT_PERMISSIONS_BY_DEFAULT_ROLE[appRole.name][
                  environmentRole.name
                ],
              createdAt: now,
              updatedAt: now,
            };
          });
        }),
      org: Api.Db.Org = {
        type: "org",
        id: orgId,
        ...getOrgKey(orgId),
        name: payload.org.name.trim(),
        settings: payload.org.settings,
        graphUpdatedAt: now,
        replicatedAt: -1,
        totalStorageBytes: 0,
        apiCallsThisMonth: 0,
        dataTransferBytesThisMonth: 0,
        createdAt: now,
        updatedAt: now,
        creatorId: userId,
      },
      orgUserDevice: Api.Db.OrgUserDevice = {
        type: "orgUserDevice",
        id: deviceId,
        ...graphKey(orgId, "orgUserDevice", deviceId),
        userId,
        isRoot: true,
        name: payload.device.name,
        pubkey: payload.device.pubkey,
        pubkeyId: getPubkeyHash(payload.device.pubkey),
        signedTrustedRoot: payload.device.signedTrustedRoot,
        trustedRootUpdatedAt: now,
        pubkeyUpdatedAt: now,
        approvedByType: "creator",
        approvedAt: now,
        updatedAt: now,
        createdAt: now,
      },
      user: Api.Db.OrgUser = {
        ...R.pick(["provider"], payload),
        type: "orgUser",
        id: userId,
        ...graphKey(orgId, "orgUser", userId),
        uid:
          payload.provider == "email"
            ? email
            : externalAuthSession!.externalUid!,
        externalAuthProviderId: externalAuthSession
          ? externalAuthSession.externalAuthProviderId
          : undefined,
        email,
        firstName: payload.user.firstName.trim(),
        lastName: payload.user.lastName.trim(),
        deviceIds: [deviceId],
        isCreator: true,
        orgRoleId: orgOwnerId,
        orgRoleUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      authTokenProvider = externalAuthSession
        ? externalAuthSession.provider
        : "email",
      authToken: Api.Db.AuthToken = {
        type: "authToken",
        ...getAuthTokenKey(orgId, userId, deviceId, token),
        token,
        orgId,
        deviceId,
        userId,
        provider: authTokenProvider,
        uid: user.uid,
        externalAuthProviderId: externalAuthSession
          ? externalAuthSession.externalAuthProviderId
          : undefined,
        expiresAt: Date.now() + org.settings.auth.tokenExpirationMs,
        createdAt: now,
        updatedAt: now,
      },
      orgUserIdByEmail: Api.Db.OrgUserIdByEmail = {
        type: "userIdByEmail",
        email: user.email,
        userId: user.id,
        orgId,
        pkey: sha256(user.email),
        skey: [orgId, user.id].join("|"),
        createdAt: now,
        updatedAt: now,
      },
      providerUid = [user.provider, user.externalAuthProviderId, user.uid]
        .filter(Boolean)
        .join("|"),
      orgUserIdByProviderUid: Api.Db.OrgUserIdByProviderUid = {
        type: "userIdByProviderUid",
        providerUid,
        userId: user.id,
        orgId,
        pkey: providerUid,
        skey: orgId,
        createdAt: now,
        updatedAt: now,
      };

    let transactionItems: Api.Db.ObjectTransactionItems = {
      puts: [
        org,
        user,
        orgUserDevice,
        authToken,
        orgUserIdByEmail,
        orgUserIdByProviderUid,
        ...orgRoles,
        ...environmentRoles,
        ...appRoles,
        ...appRoleEnvironmentRoles,
      ],
    };

    if (externalAuthSession) {
      const res = getCreateExternalAuthProviderWithTransactionItems(
        externalAuthSession,
        org.id,
        user.id,
        now
      );

      if (res) {
        const [_, externalAuthProviderTransactItems] = res;
        transactionItems = mergeObjectTransactionItems([
          transactionItems,
          externalAuthProviderTransactItems,
        ]);
      } else {
        transactionItems.softDeleteKeys = [
          R.pick(["pkey", "skey"], externalAuthSession),
        ];

        transactionItems.puts!.push({
          ...externalAuthSession,
          orgId: org.id,
          userId: user.id,
          updatedAt: now,
        } as Api.Db.ExternalAuthSession);
      }
    }

    if (verifyTokenRes) {
      transactionItems = mergeObjectTransactionItems([
        transactionItems,
        verifyTokenRes,
      ]);
    }

    const orgGraph = R.indexBy(R.prop("id"), [
      org,
      user,
      orgUserDevice,
      ...orgRoles,
      ...environmentRoles,
      ...appRoles,
      ...appRoleEnvironmentRoles,
    ]);

    const userGraph = getApiUserGraph(orgGraph, orgId, userId, deviceId, now);

    return {
      type: "handlerResult",
      response: {
        type: "tokenSession",
        orgId,
        token: authToken.token,
        provider: authToken.provider,
        ...pick(["uid", "email", "firstName", "lastName"], user),
        userId: user.id,
        deviceId: orgUserDevice.id,
        orgUserDeviceId: orgUserDevice.id,
        graph: userGraph,
        graphUpdatedAt: now,
        timestamp: now,
        envs: {},
        inheritanceOverrides: {},
        ...(env.IS_CLOUD_ENVKEY
          ? {
              hostType: <const>"cloud",
            }
          : {
              hostType: <const>"self-hosted",
              deploymentTag: env.DEPLOYMENT_TAG,
            }),
      },
      transactionItems,
      logTargetIds: [],
    };
  },
});

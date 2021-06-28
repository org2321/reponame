import { verifySignedLicense } from "../billing";
import { getAuthTokenKey } from "../models/auth_tokens";
import { apiAction, apiErr } from "../handler";
import { Api, Auth, Billing, Rbac } from "@core/types";
import { secureRandomAlphanumeric } from "@core/lib/crypto";
import { getDb, graphKey } from "../db";
import * as R from "ramda";
import { v4 as uuid } from "uuid";
import { sendBulkEmail } from "../email";
import { sha256 } from "@core/lib/crypto/utils";
import {
  getActiveInvites,
  graphTypes,
  getGroupMembershipsByObjectId,
  deleteGraphObjects,
  getActiveOrgUserDevicesByUserId,
  authz,
  getActiveDeviceGrants,
  getActiveOrInvitedOrgUsers,
  getEnvParentPermissions,
} from "@core/lib/graph";
import { getPubkeyHash } from "@core/lib/client";
import { deleteUser } from "../graph";
import { pick } from "@core/lib/utils/pick";
import produce from "immer";
import { encodeBase64, decodeUTF8 } from "tweetnacl-util";
import { getFetchActionLogTargetIdsFn } from "../models/logs";
import { scimCandidateDbKey } from "../models/provisioning";

apiAction<
  Api.Action.RequestActions["CreateInvite"],
  Api.Net.ApiResultTypes["CreateInvite"]
>({
  type: Api.ActionType.CREATE_INVITE,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (
    { payload },
    orgGraph,
    userGraph,
    auth,
    now,
    requestParams,
    transactionConn
  ) => {
    let license: Billing.License;
    try {
      license = verifySignedLicense(auth.org.id, auth.org.signedLicense, now);
    } catch (err) {
      throw await apiErr(transactionConn, (err as Error).message, 401);
    }

    const numActiveDevices = Object.values(
      getActiveOrgUserDevicesByUserId(orgGraph)
    ).flat().length;
    const numActiveInvites = getActiveInvites(orgGraph, now).length;
    const numActiveGrants = getActiveDeviceGrants(orgGraph, now).length;

    if (
      numActiveDevices + numActiveInvites + numActiveGrants >=
      license.maxDevices
    ) {
      return false;
    }

    const {
      appUserGrants,
      user: { orgRoleId, externalAuthProviderId },
    } = payload;

    const userParams = payload.user,
      email = userParams.email.toLowerCase().trim(),
      orgUsersWithEmail = getActiveOrInvitedOrgUsers(orgGraph).filter(
        (orgUser) => orgUser.email.toLowerCase().trim() == email
      );

    // Note: if you invite a user who already has an outstanding invite, it will overwrite/allow a new invitation.
    if (orgUsersWithEmail.length > 0) {
      for (let orgUser of orgUsersWithEmail) {
        if (orgUser.inviteAcceptedAt || orgUser.isCreator) {
          throw await apiErr(
            transactionConn,
            `User with email ${email} already exists`,
            403
          );
        }
        if (!authz.canRemoveFromOrg(orgGraph, auth.user.id, orgUser.id)) {
          return false;
        }
      }
    }

    return (
      authz.canInvite(userGraph, auth.user.id, { appUserGrants, orgRoleId }) &&
      // does an optional external auth provider belong to the organization?
      (externalAuthProviderId
        ? Boolean(orgGraph[externalAuthProviderId])
        : true)
    );
  },
  graphHandler: async (
    { payload },
    orgGraph,
    auth,
    now,
    requestParams,
    transactionConn
  ) => {
    let transactionItems: Api.Db.ObjectTransactionItems = { puts: [] };
    let scimCandidate: Api.Db.ScimUserCandidate | undefined;
    if (payload.scim?.candidateId) {
      scimCandidate = await getDb<Api.Db.ScimUserCandidate>(
        scimCandidateDbKey({
          orgId: auth.org.id,
          providerId: payload.scim.providerId,
          userCandidateId: payload.scim.candidateId,
        })
      );
      if (!scimCandidate) {
        throw await apiErr(
          transactionConn,
          `Cannot invite from scim candidate - scim candidate not found ${payload.scim.candidateId} ${payload.scim.providerId}`,
          422
        );
      }
      if (scimCandidate.deletedAt) {
        throw await apiErr(
          transactionConn,
          `Cannot invite user from deleted SCIM candidate ${scimCandidate.id}`,
          422
        );
      }
      if (!scimCandidate.active) {
        throw await apiErr(
          transactionConn,
          `Cannot invite user from inactive SCIM candidate ${scimCandidate.id}`,
          422
        );
      }
    }

    const userParams = payload.user,
      email = userParams.email.toLowerCase().trim(),
      activeOrgUsersWithEmail = getActiveOrInvitedOrgUsers(orgGraph).filter(
        (orgUser) => orgUser.email.toLowerCase().trim() == email
      );

    const userId = uuid(),
      user: Api.Db.OrgUser = {
        email,
        firstName: userParams.firstName.trim(),
        lastName: userParams.lastName.trim(),
        provider: userParams.provider,
        externalAuthProviderId: userParams.externalAuthProviderId,
        uid: userParams.uid,
        orgRoleId: userParams.orgRoleId,
        type: "orgUser",
        id: userId,
        ...graphKey(auth.org.id, "orgUser", userId),
        isCreator: false,
        deviceIds: [],
        invitedById: auth.user.id,
        orgRoleUpdatedAt: now,
        // link scim candidate to user
        scim: payload.scim || undefined,
        createdAt: now,
        updatedAt: now,
      };
    if (scimCandidate) {
      // link user to scim candidate
      transactionItems.puts!.push({
        ...scimCandidate,
        orgUserId: userId,
      } as Api.Db.ScimUserCandidate);
    }

    const userIdByEmail: Api.Db.OrgUserIdByEmail = {
        type: "userIdByEmail",
        email: user.email,
        userId: user.id,
        orgId: auth.org.id,
        pkey: sha256(user.email),
        skey: [auth.org.id, user.id].join("|"),
        createdAt: now,
        updatedAt: now,
      },
      providerUid = [user.provider, user.externalAuthProviderId, user.uid]
        .filter(Boolean)
        .join("|"),
      userIdByProviderUid: Api.Db.OrgUserIdByProviderUid = {
        type: "userIdByProviderUid",
        providerUid,
        userId: user.id,
        orgId: auth.org.id,
        pkey: providerUid,
        skey: auth.org.id,
        createdAt: now,
        updatedAt: now,
      };

    transactionItems.puts!.push(user, userIdByEmail, userIdByProviderUid);

    const emailToken = [
      "i",
      secureRandomAlphanumeric(26),
      encodeBase64(decodeUTF8(requestParams.host)),
    ].join("_");

    if (process.env.NODE_ENV == "development") {
      const clipboardy = require("clipboardy");
      const notifier = require("node-notifier");
      clipboardy.writeSync(emailToken);
      notifier.notify("Created invite. Token copied to clipboard.");
    }

    const inviteId = uuid(),
      invite: Api.Db.Invite = {
        type: "invite",
        id: inviteId,
        ...graphKey(auth.org.id, "invite", inviteId),
        ...pick(["provider", "uid", "externalAuthProviderId"], userParams),
        ...pick(["identityHash", "pubkey", "encryptedPrivkey"], payload),
        invitedByUserId: auth.user.id,
        invitedByDeviceId:
          auth.type == "tokenAuthContext" ? auth.orgUserDevice.id : undefined,
        signedById:
          auth.type == "tokenAuthContext"
            ? auth.orgUserDevice.id
            : auth.user.id,
        pubkeyId: getPubkeyHash(payload.pubkey),
        pubkeyUpdatedAt: now,
        inviteeId: user.id,
        deviceId: uuid(),
        signedTrustedRoot: payload.signedTrustedRoot,
        expiresAt: now + auth.org.settings.auth.inviteExpirationMs,
        createdAt: now,
        updatedAt: now,
      },
      invitePointer: Api.Db.InvitePointer = {
        type: "invitePointer",
        pkey: sha256(payload.identityHash),
        skey: emailToken,
        inviteId,
        orgId: auth.org.id,
        createdAt: now,
        updatedAt: now,
      };

    transactionItems.puts!.push(invitePointer);

    let updatedGraph = produce(orgGraph, (draft) => {
      draft[invite.id] = invite;
      draft[user.id] = user;

      if (payload.appUserGrants) {
        for (let appUserGrantParams of payload.appUserGrants) {
          const appUserGrantId = uuid(),
            appUserGrant: Api.Db.AppUserGrant = {
              type: "appUserGrant",
              id: appUserGrantId,
              ...graphKey(auth.org.id, "appUserGrant", appUserGrantId),
              userId: user.id,
              ...pick(["appId", "appRoleId"], appUserGrantParams),
              createdAt: now,
              updatedAt: now,
            };

          draft[appUserGrantId] = appUserGrant;
        }
      }
    });

    for (let orgUserWithEmail of activeOrgUsersWithEmail) {
      updatedGraph = deleteUser(updatedGraph, orgUserWithEmail.id, auth, now);
    }

    const firstName =
        auth.type == "cliUserAuthContext"
          ? auth.user.name
          : auth.user.firstName,
      fullName =
        auth.type == "cliUserAuthContext"
          ? auth.user.name
          : [auth.user.firstName, auth.user.lastName].join(" "),
      emailAction = () =>
        sendBulkEmail({
          to: user.email,
          subject: `${user.firstName}, you've been invited to access ${auth.org.name}'s EnvKey config`,
          bodyMarkdown: `Hi ${user.firstName},

${fullName} has invited you to access ${
            auth.org.name + (auth.org.name.endsWith("s") ? "'" : "'s")
          } EnvKey config.

EnvKey makes sharing api keys, environment variables, and application secrets easy and secure.

To accept, first go [here](https://www.envkey.com) and download the EnvKey App for your platform.

After installing and starting the app, click the 'Accept Invitation Or Device Grant' button on the first screen you see, then input the **Invite Token** below:

**${emailToken}**

You'll also need a **Encryption Token** that ${firstName} will send to you directly.

This invitation will remain valid for 24 hours.
`,
        });

    const scope: Rbac.OrgAccessScope = {
      userIds: new Set([user.id]),
      deviceIds: new Set([invite.id]),
      envParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      transactionItems,
      graph: updatedGraph,
      postUpdateActions: [emailAction],
      handlerContext: {
        type: Api.ActionType.CREATE_INVITE,
        inviteId: invite.id,
        inviteeId: user.id,
      },
      logTargetIds: [user.id],
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
    };
  },
});

apiAction<
  Api.Action.RequestActions["LoadInvite"],
  Api.Net.ApiResultTypes["LoadInvite"],
  Auth.InviteAuthContext
>({
  type: Api.ActionType.LOAD_INVITE,
  graphAction: true,
  skipGraphUpdatedAtCheck: true,
  authenticated: true,
  graphResponse: "loadedInvite",
  graphAuthorizer: async (
    {
      meta: {
        auth: { identityHash, emailToken: token },
      },
    },
    orgGraph,
    userGraph,
    auth,
    now
  ) => {
    const invite = R.find(
      R.propEq("identityHash", identityHash),
      getActiveInvites(orgGraph, now) as Api.Db.Invite[]
    );

    if (
      !invite ||
      invite.type != "invite" ||
      invite.deletedAt ||
      invite.acceptedAt
    ) {
      return false;
    }

    if (now >= invite.expiresAt) {
      return false;
    }

    return true;
  },
  graphHandler: async (
    action,
    orgGraph,
    auth,
    now,
    requestParams,
    transactionConn
  ) => {
    const invite = auth.invite;

    if (invite.provider != "email" && !invite.externalAuthSessionVerifiedAt) {
      // saml or oauth
      return {
        type: "response",
        response: {
          type: "requiresExternalAuthError",
          ...pick(["id", "provider", "externalAuthProviderId", "uid"], invite),
          orgId: auth.org.id,
          error: true,
          errorStatus: 422,
          errorReason: "External auth required",
        },
        logTargetIds: [],
      };
    }

    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [invite.id]: {
          ...invite,
          loadedAt: now,
        },
      },
      envs: { all: true },
      inheritanceOverrides: { all: true },
      changesets: { all: true },
      signedTrustedRoot: invite.signedTrustedRoot,
      logTargetIds: getFetchActionLogTargetIdsFn(orgGraph),
    };
  },
});

apiAction<
  Api.Action.RequestActions["RevokeInvite"],
  Api.Net.ApiResultTypes["RevokeInvite"]
>({
  type: Api.ActionType.REVOKE_INVITE,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (
    { payload: { id } },
    orgGraph,
    userGraph,
    auth,
    now
  ) => authz.canRevokeInvite(userGraph, auth.user.id, id, now),
  graphHandler: async (action, orgGraph, auth, now) => {
    const invite = orgGraph[action.payload.id] as Api.Db.Invite,
      byType = graphTypes(orgGraph),
      targetOrgUser = orgGraph[invite.inviteeId] as Api.Db.OrgUser,
      targetAppUserGrants = byType.appUserGrants.filter(
        R.propEq("userId", invite.inviteeId)
      ),
      targetGroupMemberships =
        getGroupMembershipsByObjectId(orgGraph)[invite.inviteeId] || [],
      targetAppGroupUsers = byType.appGroupUsers.filter(
        R.propEq("userId", invite.inviteeId)
      );

    const scope: Rbac.OrgAccessScope = {
      userIds: new Set([invite.inviteeId]),
      deviceIds: new Set([invite.id]),
      envParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(
        orgGraph,
        [
          invite.id,
          targetOrgUser.id,
          ...targetAppUserGrants.map(R.prop("id")),
          ...targetGroupMemberships.map(R.prop("id")),
          ...targetAppGroupUsers.map(R.prop("id")),
        ],
        now
      ),
      handlerContext: {
        type: action.type,
        invite,
      },
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [invite.inviteeId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["AcceptInvite"],
  Api.Net.ApiResultTypes["AcceptInvite"],
  Auth.InviteAuthContext
>({
  type: Api.ActionType.ACCEPT_INVITE,
  authenticated: true,
  graphAction: true,
  graphResponse: "session",
  graphAuthorizer: async (
    {
      payload,
      meta: {
        auth: { identityHash },
      },
    },
    orgGraph,
    userGraph,
    auth,
    now
  ) => {
    const invite = R.find(
      R.propEq("identityHash", identityHash),
      getActiveInvites(orgGraph, now) as Api.Db.Invite[]
    );
    if (
      !invite ||
      invite.type != "invite" ||
      invite.deletedAt ||
      invite.acceptedAt ||
      !invite.loadedAt ||
      (invite.provider != "email" && !invite.externalAuthSessionVerifiedAt)
    ) {
      return false;
    }

    if (now >= invite.expiresAt) {
      return false;
    }

    return true;
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const invite = auth.invite,
      deviceId = invite.deviceId,
      orgUserDevice: Api.Db.OrgUserDevice = {
        type: "orgUserDevice",
        id: deviceId,
        ...graphKey(auth.org.id, "orgUserDevice", deviceId),
        userId: invite.inviteeId,
        name: payload.device.name,
        pubkey: payload.device.pubkey,
        pubkeyId: getPubkeyHash(payload.device.pubkey),
        pubkeyUpdatedAt: now,
        approvedByType: "invite",
        inviteId: invite.id,
        signedTrustedRoot: payload.device.signedTrustedRoot,
        trustedRootUpdatedAt: now,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      token = secureRandomAlphanumeric(26),
      authToken: Api.Db.AuthToken = {
        type: "authToken",
        ...getAuthTokenKey(auth.org.id, auth.user.id, deviceId, token),
        token,
        orgId: auth.org.id,
        deviceId,
        userId: auth.user.id,
        provider: invite.provider,
        uid: invite.uid,
        externalAuthProviderId: invite.externalAuthProviderId,
        expiresAt: Date.now() + auth.org.settings.auth.tokenExpirationMs,
        createdAt: now,
        updatedAt: now,
      },
      transactionItems: Api.Db.ObjectTransactionItems = {
        puts: [authToken],
      };

    let updatedGraph: Api.Graph.OrgGraph = {
      ...orgGraph,
      [invite.id]: {
        ...invite,
        acceptedAt: now,
      },
      [deviceId]: orgUserDevice,
      [auth.user.id]: {
        ...auth.user,
        deviceIds: [deviceId],
        inviteAcceptedAt: now,
      },
    };

    updatedGraph = produce(updatedGraph, (draft) => {
      const replacementDrafts = graphTypes(draft)
        .rootPubkeyReplacements as Api.Db.RootPubkeyReplacement[];

      for (let replacementDraft of replacementDrafts) {
        if (replacementDraft.processedAtById[invite.id] === false) {
          replacementDraft.processedAtById[invite.id] = now;
        }
      }
    });

    const scope: Rbac.OrgAccessScope = {
      userIds: new Set([auth.user.id]),
      deviceIds: new Set([invite.id, deviceId]),
      envParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      transactionItems,
      handlerContext: {
        type: Api.ActionType.ACCEPT_INVITE,
        authToken,
        orgUserDevice,
        invite,
      },
      logTargetIds: [invite.inviteeId],
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
    };
  },
});

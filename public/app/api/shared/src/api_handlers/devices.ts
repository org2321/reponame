import { getFetchActionLogTargetIdsFn } from "../models/logs";
import { verifySignedLicense } from "../billing";
import { getAuthTokenKey } from "../models/auth_tokens";
import { sendBulkEmail } from "../email";
import { pick } from "@core/lib/utils/pick";
import { apiAction, apiErr } from "../handler";
import { Api, Auth, Billing, Rbac } from "@core/types";
import { v4 as uuid } from "uuid";
import { graphKey } from "../db";
import { sha256 } from "@core/lib/crypto/utils";
import {
  getActiveDeviceGrants,
  getActiveInvites,
  getExpiredDeviceGrantsByGranteeId,
  getActiveOrgUserDevicesByUserId,
  deleteGraphObjects,
  authz,
  graphTypes,
} from "@core/lib/graph";
import * as R from "ramda";
import { secureRandomAlphanumeric } from "@core/lib/crypto/utils";
import { encodeBase64, decodeUTF8 } from "tweetnacl-util";
import { getPubkeyHash } from "@core/lib/client";
import produce from "immer";
import { deleteDevice } from "../graph";
import { log } from "@core/lib/utils/logger";

apiAction<
  Api.Action.RequestActions["CreateDeviceGrant"],
  Api.Net.ApiResultTypes["CreateDeviceGrant"]
>({
  type: Api.ActionType.CREATE_DEVICE_GRANT,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (
    { payload: { granteeId } },
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

    return authz.canCreateDeviceGrant(userGraph, auth.user.id, granteeId);
  },
  graphHandler: async (action, orgGraph, auth, now, requestParams) => {
    let updatedGraph = orgGraph;

    const existingExpiredDeviceGrants = getExpiredDeviceGrantsByGranteeId(
        orgGraph,
        now
      )[action.payload.granteeId],
      targetOrgUser = orgGraph[action.payload.granteeId] as Api.Db.OrgUser;

    if (existingExpiredDeviceGrants) {
      updatedGraph = deleteGraphObjects(
        updatedGraph,
        existingExpiredDeviceGrants.map(R.prop("id")),
        now
      );
    }

    const emailToken = [
      "dg",
      secureRandomAlphanumeric(26),
      encodeBase64(decodeUTF8(requestParams.host)),
    ].join("_");

    if (process.env.NODE_ENV == "development") {
      const clipboardy = require("clipboardy");
      const notifier = require("node-notifier");
      clipboardy.writeSync(emailToken);
      notifier.notify("Created invite. Token copied to clipboard.");
    }

    const deviceGrantId = uuid(),
      newDeviceGrant: Api.Db.DeviceGrant = {
        type: "deviceGrant",
        id: deviceGrantId,
        ...graphKey(auth.org.id, "deviceGrant", deviceGrantId),
        ...pick(["provider", "uid", "externalAuthProviderId"], targetOrgUser),
        ...pick(
          ["pubkey", "encryptedPrivkey", "granteeId", "identityHash"],
          action.payload
        ),
        deviceId: uuid(),
        orgId: auth.org.id,
        grantedByUserId: auth.user.id,
        grantedByDeviceId:
          auth.type == "tokenAuthContext" ? auth.orgUserDevice.id : undefined,
        signedById:
          auth.type == "tokenAuthContext"
            ? auth.orgUserDevice.id
            : auth.user.id,
        pubkeyId: getPubkeyHash(action.payload.pubkey),
        pubkeyUpdatedAt: now,
        expiresAt: now + auth.org.settings.auth.deviceGrantExpirationMs,
        signedTrustedRoot: action.payload.signedTrustedRoot,
        createdAt: now,
        updatedAt: now,
      },
      deviceGrantPointer: Api.Db.DeviceGrantPointer = {
        type: "deviceGrantPointer",
        pkey: sha256(action.payload.identityHash),
        skey: emailToken,
        deviceGrantId,
        orgId: auth.org.id,
        createdAt: now,
        updatedAt: now,
      };

    updatedGraph = {
      ...updatedGraph,
      [deviceGrantId]: newDeviceGrant,
    };

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
          to: targetOrgUser.email,
          subject: `${targetOrgUser.firstName}, you've been approved to access ${auth.org.name}'s EnvKey config on a new device`,
          bodyMarkdown: `Hi ${targetOrgUser.firstName},

${fullName} has approved you to access ${
            auth.org.name + (auth.org.name.endsWith("s") ? "'" : "'s")
          } EnvKey config on a new device.

To accept this grant, first ensure you have EnvKey installed on your device. If you don't, go [here](https://www.envkey.com) and download the EnvKey App for your platform.

After installing and starting the app, click the 'Accept Invitation Or Device Grant' button on the first screen you see, then input the **Grant Token** below:

**${emailToken}**

You'll also need a **Encryption Token** that ${firstName} will send to you directly.

This grant will remain valid for 24 hours.
`,
        });

    const scope: Rbac.OrgAccessScope = {
      envParentIds: "all",
      userIds: new Set([newDeviceGrant.granteeId]),
      deviceIds: new Set([newDeviceGrant.id]),
    };

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      handlerContext: {
        type: action.type,
        granteeId: newDeviceGrant.granteeId,
        createdId: deviceGrantId,
      },
      transactionItems: {
        puts: [deviceGrantPointer],
      },
      postUpdateActions: [emailAction],
      encryptedKeysScope: scope,
      logTargetIds:
        auth.user.id == newDeviceGrant.granteeId
          ? []
          : [newDeviceGrant.granteeId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["LoadDeviceGrant"],
  Api.Net.ApiResultTypes["LoadDeviceGrant"],
  Auth.DeviceGrantAuthContext
>({
  type: Api.ActionType.LOAD_DEVICE_GRANT,
  graphAction: true,
  skipGraphUpdatedAtCheck: true,
  authenticated: true,
  graphResponse: "loadedDeviceGrant",
  graphAuthorizer: async (
    {
      meta: {
        auth: { identityHash },
      },
    },
    orgGraph,
    userGraph,
    auth,
    now
  ) => {
    const activeDeviceGrants = getActiveDeviceGrants(
        orgGraph,
        now
      ) as Api.Db.DeviceGrant[],
      deviceGrant = R.find(
        R.propEq("identityHash", identityHash),
        activeDeviceGrants
      );

    if (
      !deviceGrant ||
      deviceGrant.type != "deviceGrant" ||
      deviceGrant.deletedAt ||
      deviceGrant.acceptedAt
    ) {
      return false;
    }

    if (now >= deviceGrant.expiresAt) {
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
    const deviceGrant = auth.deviceGrant;
    if (
      deviceGrant.provider != "email" &&
      !deviceGrant.externalAuthSessionVerifiedAt
    ) {
      return {
        type: "response",
        response: {
          type: "requiresExternalAuthError",
          ...pick(
            ["id", "provider", "externalAuthProviderId", "uid"],
            deviceGrant
          ),
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
        [deviceGrant.id]: {
          ...deviceGrant,
          loadedAt: now,
        },
      },
      envs: { all: true },
      inheritanceOverrides: { all: true },
      changesets: { all: true },
      signedTrustedRoot: deviceGrant.signedTrustedRoot,
      logTargetIds: getFetchActionLogTargetIdsFn(orgGraph),
    };
  },
});

apiAction<
  Api.Action.RequestActions["RevokeDeviceGrant"],
  Api.Net.ApiResultTypes["RevokeDeviceGrant"]
>({
  type: Api.ActionType.REVOKE_DEVICE_GRANT,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (
    { payload: { id } },
    orgGraph,
    userGraph,
    auth,
    now
  ) => authz.canRevokeDeviceGrant(userGraph, auth.user.id, id, now),
  graphHandler: async (action, orgGraph, auth, now) => {
    const deviceGrant = orgGraph[action.payload.id] as Api.Db.DeviceGrant;

    const scope: Rbac.OrgAccessScope = {
      envParentIds: "all",
      userIds: new Set([deviceGrant.granteeId]),
      deviceIds: new Set([deviceGrant.id]),
    };

    return {
      type: "graphHandlerResult",
      graph: deleteGraphObjects(orgGraph, [deviceGrant.id], now),
      handlerContext: {
        type: action.type,
        deviceGrant,
      },
      encryptedKeysScope: scope,
      logTargetIds:
        auth.user.id == deviceGrant.granteeId ? [] : [deviceGrant.granteeId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["AcceptDeviceGrant"],
  Api.Net.ApiResultTypes["AcceptDeviceGrant"],
  Auth.DeviceGrantAuthContext
>({
  type: Api.ActionType.ACCEPT_DEVICE_GRANT,
  graphAction: true,
  authenticated: true,
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
    const deviceGrant = R.find(
      R.propEq("identityHash", identityHash),
      getActiveDeviceGrants(orgGraph, now) as Api.Db.DeviceGrant[]
    );

    if (
      !deviceGrant ||
      deviceGrant.type != "deviceGrant" ||
      deviceGrant.deletedAt ||
      deviceGrant.acceptedAt ||
      !deviceGrant.loadedAt
    ) {
      return false;
    }

    if (now >= deviceGrant.expiresAt) {
      return false;
    }

    // ensure device name is unique for this user
    const existingDeviceNames = new Set(
      (
        getActiveOrgUserDevicesByUserId(orgGraph)[deviceGrant.granteeId] ?? []
      ).map(({ name }) => name.trim().toLowerCase())
    );

    if (existingDeviceNames.has(payload.device.name.trim().toLowerCase())) {
      return false;
    }

    return true;
  },
  graphHandler: async ({ payload }, orgGraph, auth, now) => {
    const deviceGrant = auth.deviceGrant,
      deviceId = deviceGrant.deviceId,
      orgUserDevice: Api.Db.OrgUserDevice = {
        type: "orgUserDevice",
        id: deviceId,
        ...graphKey(auth.org.id, "orgUserDevice", deviceId),
        userId: deviceGrant.granteeId,
        name: payload.device.name,
        pubkey: payload.device.pubkey,
        pubkeyId: getPubkeyHash(payload.device.pubkey),
        pubkeyUpdatedAt: now,
        approvedByType: "deviceGrant",
        deviceGrantId: deviceGrant.id,
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
        provider: deviceGrant.provider,
        uid: deviceGrant.uid,
        externalAuthProviderId: deviceGrant.externalAuthProviderId,
        expiresAt: Date.now() + auth.org.settings.auth.tokenExpirationMs,
        createdAt: now,
        updatedAt: now,
      },
      transactionItems: Api.Db.ObjectTransactionItems = {
        puts: [authToken],
      };

    let updatedGraph: Api.Graph.OrgGraph = {
      ...orgGraph,
      [deviceGrant.id]: {
        ...deviceGrant,
        deviceId,
        acceptedAt: now,
      },
      [deviceId]: orgUserDevice,
      [auth.user.id]: {
        ...auth.user,
        deviceIds: [...(auth.user.deviceIds || []), deviceId],
        inviteAcceptedAt: now,
      },
    };

    updatedGraph = produce(updatedGraph, (draft) => {
      const replacementDrafts = graphTypes(draft)
        .rootPubkeyReplacements as Api.Db.RootPubkeyReplacement[];

      for (let replacementDraft of replacementDrafts) {
        if (replacementDraft.processedAtById[deviceGrant.id] === false) {
          replacementDraft.processedAtById[deviceGrant.id] = now;
        }
      }
    });

    const scope: Rbac.OrgAccessScope = {
      userIds: new Set([auth.user.id]),
      deviceIds: new Set([deviceId, deviceGrant.id]),
      envParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      transactionItems,
      handlerContext: {
        type: Api.ActionType.ACCEPT_DEVICE_GRANT,
        authToken,
        orgUserDevice,
        deviceGrant,
      },
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds:
        auth.user.id == deviceGrant.granteeId ? [] : [deviceGrant.granteeId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["RevokeDevice"],
  Api.Net.ApiResultTypes["RevokeDevice"]
>({
  type: Api.ActionType.REVOKE_DEVICE,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (
    { payload: { id } },
    orgGraph,
    userGraph,
    auth,
    now
  ) => authz.canRevokeDevice(userGraph, auth.user.id, id),
  graphHandler: async ({ type, payload }, orgGraph, auth, now) => {
    const orgUserDevice = orgGraph[payload.id] as Api.Db.OrgUserDevice;

    const scope: Rbac.OrgAccessScope = {
      userIds: new Set([orgUserDevice.userId]),
      deviceIds: new Set([payload.id]),
      envParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: deleteDevice(orgGraph, payload.id, auth, now),
      transactionItems: {
        softDeleteScopes: [
          {
            pkey: [auth.org.id, "tokens"].join("|"),
            scope: [orgUserDevice.userId, orgUserDevice.id].join("|"),
          },
        ],
      },
      handlerContext: {
        type,
        device: orgUserDevice,
      },
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [orgUserDevice.id, orgUserDevice.userId],
    };
  },
  clearSockets: (auth, action, orgGraph) => [
    {
      orgId: auth.org.id,
      userId: (orgGraph[action.payload.id] as Api.Db.OrgUserDevice).userId,
      deviceId: action.payload.id,
    },
  ],
});

apiAction<
  Api.Action.RequestActions["ForgetDevice"],
  Api.Net.ApiResultTypes["ForgetDevice"],
  Auth.TokenAuthContext
>({
  type: Api.ActionType.FORGET_DEVICE,
  graphAction: true,
  authenticated: true,
  skipGraphUpdatedAtCheck: true,
  graphHandler: async (action, orgGraph, auth, now) => {
    const scope: Rbac.OrgAccessScope = {
      userIds: new Set([auth.user.id]),
      deviceIds: new Set([auth.orgUserDevice.id]),
      envParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: deleteDevice(orgGraph, auth.orgUserDevice.id, auth, now),
      transactionItems: {
        softDeleteScopes: [
          {
            pkey: [auth.org.id, "tokens"].join("|"),
            scope: [auth.user.id, auth.orgUserDevice.id].join("|"),
          },
        ],
      },
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [],
    };
  },
  clearSockets: (auth) => [
    {
      orgId: auth.org.id,
      userId: auth.user.id,
      deviceId: auth.orgUserDevice.id,
    },
  ],
});

import { getFetchActionLogTargetIdsFn } from "../models/logs";
import { sendEmail } from "../email";
import { sha256 } from "@core/lib/crypto/utils";
import { getAuthTokenKey } from "../models/auth_tokens";
import * as R from "ramda";
import { apiAction, apiErr } from "../handler";
import { Api, Auth, Rbac } from "@core/types";
import {
  getActiveRecoveryKeysByUserId,
  getOrgUserDevicesByUserId,
  graphTypes,
  deleteGraphObjects,
} from "@core/lib/graph";
import { v4 as uuid } from "uuid";
import { graphKey, getDb } from "../db";
import { pick } from "@core/lib/utils/pick";
import { secureRandomAlphanumeric } from "@core/lib/crypto/utils";
import { getPubkeyHash } from "@core/lib/client";

import produce from "immer";

apiAction<
  Api.Action.RequestActions["CreateRecoveryKey"],
  Api.Net.ApiResultTypes["CreateRecoveryKey"],
  Auth.TokenAuthContext
>({
  type: Api.ActionType.CREATE_RECOVERY_KEY,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) =>
    auth.orgPermissions.has("org_generate_recovery_key"),
  graphHandler: async (
    { type, payload },
    orgGraph,
    auth,
    now,
    requestParams,
    transactionConn
  ) => {
    const activeRecoveryKey =
      getActiveRecoveryKeysByUserId(orgGraph)[auth.user.id];
    let updatedGraph = orgGraph;
    if (activeRecoveryKey) {
      updatedGraph = deleteGraphObjects(orgGraph, [activeRecoveryKey.id], now);
    }

    const recoveryKeyId = uuid(),
      recoveryKey: Api.Db.RecoveryKey = {
        type: "recoveryKey",
        id: recoveryKeyId,
        ...graphKey(auth.org.id, "recoveryKey", recoveryKeyId),
        ...pick(
          ["identityHash", "encryptedPrivkey", "pubkey"],
          payload.recoveryKey
        ),
        signedTrustedRoot: payload.signedTrustedRoot,
        userId: auth.user.id,
        creatorDeviceId: auth.orgUserDevice.id,
        signedById: auth.orgUserDevice.id,
        pubkeyId: getPubkeyHash(payload.recoveryKey.pubkey),
        pubkeyUpdatedAt: now,
        deviceId: uuid(),
        createdAt: now,
        updatedAt: now,
      },
      recoveryKeyPointer: Api.Db.RecoveryKeyPointer = {
        type: "recoveryKeyPointer",
        pkey: sha256(payload.recoveryKey.identityHash),
        skey: "recoveryKeyPointer",
        orgId: auth.org.id,
        recoveryKeyId,
        createdAt: now,
        updatedAt: now,
      };

    return {
      type: "graphHandlerResult",
      graph: { ...updatedGraph, [recoveryKeyId]: recoveryKey },
      transactionItems: {
        puts: [recoveryKeyPointer],
      },
      handlerContext: {
        type,
        createdId: recoveryKeyId,
      },
      logTargetIds: [],
      encryptedKeysScope: {
        userIds: new Set([recoveryKey.userId]),
        deviceIds: new Set([recoveryKey.id]),
        envParentId: "all",
      },
    };
  },
});

apiAction<
  Api.Action.RequestActions["LoadRecoveryKey"],
  Api.Net.ApiResultTypes["LoadRecoveryKey"],
  Auth.RecoveryKeyAuthContext
>({
  type: Api.ActionType.LOAD_RECOVERY_KEY,
  graphAction: true,
  authenticated: true,
  skipGraphUpdatedAtCheck: true,
  graphResponse: "loadedRecoveryKey",
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    if (!auth.orgPermissions.has("org_generate_recovery_key")) {
      return false;
    }
    const activeRecoveryKey =
      getActiveRecoveryKeysByUserId(orgGraph)[auth.user.id];
    if (!activeRecoveryKey || activeRecoveryKey.type != "recoveryKey") {
      return false;
    }

    return true;
  },
  graphHandler: async (
    { type, payload },
    orgGraph,
    auth,
    now,
    requestParams,
    transactionConn
  ) => {
    const activeRecoveryKey = getActiveRecoveryKeysByUserId(orgGraph)[
        auth.user.id
      ] as Api.Db.RecoveryKey,
      handlerContext: Api.HandlerContext = {
        type,
        recoveryKey: activeRecoveryKey,
      };

    if (auth.user.provider == "email") {
      if (!payload.emailToken) {
        const emailToken = secureRandomAlphanumeric(26);

        if (process.env.NODE_ENV == "development") {
          const clipboardy = require("clipboardy");
          const notifier = require("node-notifier");
          clipboardy.writeSync(emailToken);
          notifier.notify("Email token copied to clipboard.");
        }

        const emailAction = () =>
          sendEmail({
            to: auth.user.email,
            subject: `${auth.user.firstName}, here's your EnvKey Account Recovery Email Confirmation Token`,
            bodyMarkdown: `Hi ${auth.user.firstName},

An attempt has been made to recover your ${auth.org.name} EnvKey account. If it **wasn't** you, it could mean someone else has obtained your Account Recovery Key, so you should generate a new one as soon as possible.

If it **was** you, here's your Email Confirmation Token:

**${emailToken}**

Please copy it and return to the EnvKey App to complete the Account Recovery process.
`,
          });

        return {
          type: "response",
          response: {
            type: "requiresEmailAuthError",
            email: auth.user.email,
            error: true,
            errorStatus: 422,
            errorReason: "Email auth required",
          },
          postUpdateActions: [emailAction],
          transactionItems: {
            puts: [
              {
                ...activeRecoveryKey,
                emailToken,
                updatedAt: now,
              } as Api.Db.RecoveryKey,
            ],
          },
          handlerContext,
          logTargetIds: [],
        };
      } else if (
        !activeRecoveryKey.emailToken ||
        sha256(payload.emailToken) !== sha256(activeRecoveryKey.emailToken)
      ) {
        throw await apiErr(transactionConn, "Not found", 404);
      }
    }

    if (
      auth.user.provider != "email" &&
      !activeRecoveryKey.externalAuthSessionVerifiedAt
    ) {
      return {
        type: "response",
        response: {
          type: "requiresExternalAuthError",
          ...pick(
            ["id", "provider", "externalAuthProviderId", "uid"],
            auth.user
          ),
          orgId: auth.org.id,
          error: true,
          errorStatus: 422,
          errorReason: "External auth required",
        },
        handlerContext,
        logTargetIds: [],
      };
    }

    return {
      type: "graphHandlerResult",
      graph: orgGraph,
      envs: { all: true },
      inheritanceOverrides: { all: true },
      changesets: { all: true },
      signedTrustedRoot: activeRecoveryKey.signedTrustedRoot,
      handlerContext,
      logTargetIds: getFetchActionLogTargetIdsFn(orgGraph),
    };
  },
});

apiAction<
  Api.Action.RequestActions["RedeemRecoveryKey"],
  Api.Net.ApiResultTypes["RedeemRecoveryKey"],
  Auth.TokenAuthContext
>({
  type: Api.ActionType.REDEEM_RECOVERY_KEY,
  graphAction: true,
  authenticated: true,
  graphResponse: "session",
  graphAuthorizer: async ({ payload }, orgGraph, userGraph, auth) => {
    if (!auth.orgPermissions.has("org_generate_recovery_key")) {
      return false;
    }

    const activeRecoveryKey = getActiveRecoveryKeysByUserId(orgGraph)[
      auth.user.id
    ] as Api.Db.RecoveryKey;

    if (!activeRecoveryKey || activeRecoveryKey.type != "recoveryKey") {
      return false;
    }

    return true;
  },
  graphHandler: async (
    { type, payload },
    orgGraph,
    auth,
    now,
    requestParams,
    transactionConn
  ) => {
    const activeRecoveryKey = getActiveRecoveryKeysByUserId(orgGraph)[
      auth.user.id
    ] as Api.Db.RecoveryKey;

    if (
      (auth.user.provider == "email" &&
        (!payload.emailToken ||
          !activeRecoveryKey.emailToken ||
          sha256(payload.emailToken) !==
            sha256(activeRecoveryKey.emailToken))) ||
      (auth.user.provider != "email" &&
        !activeRecoveryKey.externalAuthSessionVerifiedAt)
    ) {
      throw await apiErr(transactionConn, "Not found", 404);
    }

    const orgUser = orgGraph[auth.user.id] as Api.Db.OrgUser,
      orgUserDevices = (getOrgUserDevicesByUserId(orgGraph)[auth.user.id] ??
        []) as Api.Db.OrgUserDevice[],
      newOrgUserDevice: Api.Db.OrgUserDevice = {
        type: "orgUserDevice",
        id: activeRecoveryKey.deviceId,
        ...graphKey(auth.org.id, "orgUserDevice", activeRecoveryKey.deviceId),
        userId: auth.user.id,
        name: payload.device.name,
        pubkey: payload.device.pubkey,
        pubkeyId: getPubkeyHash(payload.device.pubkey),
        pubkeyUpdatedAt: now,
        signedTrustedRoot: payload.device.signedTrustedRoot,
        trustedRootUpdatedAt: now,
        approvedByType: "recoveryKey",
        recoveryKeyId: activeRecoveryKey.id,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      token = secureRandomAlphanumeric(26),
      authToken: Api.Db.AuthToken = {
        type: "authToken",
        ...getAuthTokenKey(
          auth.org.id,
          auth.user.id,
          activeRecoveryKey.deviceId,
          token
        ),
        token,
        orgId: auth.org.id,
        deviceId: activeRecoveryKey.deviceId,
        userId: auth.user.id,
        provider: orgUser.provider,
        uid: orgUser.uid,
        externalAuthProviderId: orgUser.externalAuthProviderId,
        expiresAt: Date.now() + auth.org.settings.auth.tokenExpirationMs,
        createdAt: now,
        updatedAt: now,
      };

    let updatedGraph = {
      ...orgGraph,
      [activeRecoveryKey.id]: {
        ...activeRecoveryKey,
        redeemedAt: now,
      },
      [newOrgUserDevice.id]: newOrgUserDevice,
      [orgUser.id]: {
        ...orgUser,
        deviceIds: [activeRecoveryKey.deviceId],
      },
    };
    for (let orgUserDevice of orgUserDevices) {
      updatedGraph = {
        ...updatedGraph,
        [orgUserDevice.id]: {
          ...orgUserDevice,
          deactivatedAt: now,
        },
      };
    }

    updatedGraph = produce(updatedGraph, (draft) => {
      const replacementDrafts = graphTypes(draft)
        .rootPubkeyReplacements as Api.Db.RootPubkeyReplacement[];

      for (let replacementDraft of replacementDrafts) {
        if (replacementDraft.processedAtById[activeRecoveryKey.id] === false) {
          replacementDraft.processedAtById[activeRecoveryKey.id] = now;
        }
      }
    });

    const scope: Rbac.OrgAccessScope = {
      userIds: new Set([orgUser.id]),
      deviceIds: new Set([activeRecoveryKey.id, newOrgUserDevice.id]),
      envParentIds: "all",
    };

    return {
      type: "graphHandlerResult",
      graph: updatedGraph,
      transactionItems: {
        puts: [authToken],
        softDeleteScopes: [
          {
            pkey: [auth.org.id, "tokens"].join("|"),
            scope: auth.user.id,
          },
        ],
        hardDeleteEncryptedKeyParams: orgUserDevices.map(
          ({ id: deviceId }) => ({
            orgId: auth.org.id,
            userId: auth.user.id,
            deviceId,
            blobType: "env",
          })
        ),
      },
      handlerContext: {
        type,
        authToken,
        orgUserDevice: newOrgUserDevice,
        recoveryKey: activeRecoveryKey,
      },
      orgAccessChangeScope: scope,
      encryptedKeysScope: scope,
      logTargetIds: [],
    };
  },
  clearSockets: (auth, action, orgGraph) => {
    const orgUserDevices = (
      (getOrgUserDevicesByUserId(orgGraph)[auth.user.id] ??
        []) as Api.Db.OrgUserDevice[]
    ).filter(({ deactivatedAt }) => Boolean(deactivatedAt));
    return orgUserDevices.map(({ id }) => ({
      orgId: auth.org.id,
      userId: auth.user.id,
      deviceId: id,
    }));
  },
});

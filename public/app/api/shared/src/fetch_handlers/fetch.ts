import { updateTrustedRoot } from "../models/crypto";
import { apiAction, apiErr } from "../handler";
import { Api } from "@core/types";
import { getFetchResponse, getHandlerContext, getTargetIds } from "../fetch";
import { graphKey, getDb, query } from "../db";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import * as R from "ramda";
import {
  getScope,
  getGeneratedEnvkeyEncryptedKeyOrBlobComposite,
} from "@core/lib/blob";

apiAction<
  Api.Action.RequestActions["FetchEnvkey"],
  Api.Net.ApiResultTypes["FetchEnvkey"]
>({
  type: Api.ActionType.FETCH_ENVKEY,
  graphAction: false,
  authenticated: false,
  handler: async ({ type, payload }, now, requestParams, transactionConn) => {
    const { envkeyIdPart } = payload;
    // The id part is the first section of the envkey, terminated by a dash. If somebody sends additional parts, that'd either be the decryption key and/or the host. Most likely a mistake by a 3rd party library developer.
    if (!envkeyIdPart || envkeyIdPart.includes("-")) {
      throw await apiErr(transactionConn, "bad envkey id format", 404);
    }
    const [generatedEnvkey, encryptedKeys] = await Promise.all([
      query<Api.Db.GeneratedEnvkey>({
        scope: ["g", "generatedEnvkey", envkeyIdPart].join("|"),
      }).then((res) => res[0]),

      query<Api.Db.GeneratedEnvkeyEncryptedKey>({
        pkey: envkeyIdPart,
        omitData: requestParams.method == "head",
      }),
    ]);

    if (!generatedEnvkey || generatedEnvkey.deletedAt) {
      throw await apiErr(transactionConn, "not found", 404);
    }

    const blobScopes = R.uniq(
      encryptedKeys.map(
        (encryptedKey) =>
          getScope({
            blobType: "env",
            envParentId: encryptedKey.blockId ?? encryptedKey.envParentId,
            environmentId: encryptedKey.environmentId,
            envPart: "env",
          })!
      )
    );

    const orgId = generatedEnvkey.pkey;

    const [allRootPubkeyReplacements, blobs] = await Promise.all([
      query<Api.Db.RootPubkeyReplacement>({
        pkey: generatedEnvkey.pkey,
        scope: "g|rootPubkeyReplacement",
        sortBy: "createdAt",
      }),
      encryptedKeys.length > 0
        ? query<Api.Db.EncryptedBlob>({
            pkey: [orgId, "encryptedBlobs"].join("|"),
            scope: blobScopes,
          })
        : Promise.resolve([]),
    ]);

    const response = getFetchResponse(
      generatedEnvkey,
      encryptedKeys,
      R.indexBy(getGeneratedEnvkeyEncryptedKeyOrBlobComposite, blobs),
      allRootPubkeyReplacements.filter(
        (replacement) =>
          !replacement.deletedAt &&
          replacement.processedAtById[generatedEnvkey.id] === false
      )
    );

    return {
      type: "handlerResult",
      response,
      handlerContext: getHandlerContext(generatedEnvkey, encryptedKeys),
      logTargetIds: getTargetIds(generatedEnvkey, encryptedKeys),
    };
  },
});

apiAction<
  Api.Action.RequestActions["CheckEnvkey"],
  Api.Net.ApiResultTypes["CheckEnvkey"]
>({
  type: Api.ActionType.CHECK_ENVKEY,
  graphAction: false,
  authenticated: false,
  handler: async ({ type, payload }, now, requestParams, transactionConn) => {
    const { envkeyIdPart } = payload;
    if (!envkeyIdPart || envkeyIdPart.includes("-")) {
      throw await apiErr(transactionConn, "bad envkey id format", 404);
    }
    const generatedEnvkey = await query<Api.Db.GeneratedEnvkey>({
      scope: ["g", "generatedEnvkey", envkeyIdPart].join("|"),
    }).then((res) => res[0]);

    if (!generatedEnvkey || generatedEnvkey.deletedAt) {
      throw await apiErr(transactionConn, "not found", 404);
    }

    const keyableParent = await query<Api.Db.KeyableParent>({
      scope: [
        "g",
        generatedEnvkey.keyableParentType,
        generatedEnvkey.keyableParentId,
      ].join("|"),
    }).then((res) => res[0]);

    if (!keyableParent || keyableParent.deletedAt) {
      throw await apiErr(transactionConn, "not found", 404);
    }

    return {
      type: "handlerResult",
      response: {
        type: "checkResult",
        appId: generatedEnvkey.appId,
        orgId: generatedEnvkey.pkey,
      },
      handlerContext: {
        type,
        orgId: generatedEnvkey.pkey,
        actorId:
          keyableParent.type == "localKey"
            ? keyableParent.userId
            : keyableParent.id,
        generatedEnvkey,
      },
      logTargetIds: [generatedEnvkey.appId],
    };
  },
});

apiAction<
  Api.Action.RequestActions["EnvkeyFetchUpdateTrustedRootPubkey"],
  Api.Net.ApiResultTypes["EnvkeyFetchUpdateTrustedRootPubkey"]
>({
  type: Api.ActionType.ENVKEY_FETCH_UPDATE_TRUSTED_ROOT_PUBKEY,
  authenticated: false,
  graphAction: false,
  handler: async ({ type, payload }, now, requestParams, transactionConn) => {
    const generatedEnvkey = await getDb<Api.Db.GeneratedEnvkey>(
      graphKey(payload.orgId, "generatedEnvkey", payload.envkeyIdPart)
    );

    if (!generatedEnvkey) {
      throw await apiErr(transactionConn, "not found", 404);
    }

    const signedData = R.props(
      ["envkeyIdPart", "orgId", "replacementIds", "signedTrustedRoot"],
      payload
    );
    if (
      !nacl.sign.detached.verify(
        naclUtil.decodeUTF8(JSON.stringify(signedData)),
        naclUtil.decodeBase64(payload.signature),
        naclUtil.decodeBase64(generatedEnvkey.pubkey.keys.signingKey)
      )
    ) {
      throw await apiErr(transactionConn, "invalid signature", 401);
    }

    const updateRes = await updateTrustedRoot(
      payload.orgId,
      generatedEnvkey,
      payload.replacementIds,
      payload.signedTrustedRoot,
      now,
      transactionConn
    );

    return {
      ...updateRes,
      handlerContext: {
        type,
        actorId: generatedEnvkey.keyableParentId,
      },
      logTargetIds: [generatedEnvkey.id],
    };
  },
});

import { Draft } from "immer";
import * as R from "ramda";
import { Client, Api, Model, Blob, Crypto } from "@core/types";
import { decrypt, decryptSymmetricWithKey } from "@core/lib/crypto";
import { parseUserEncryptedKeyOrBlobComposite } from "@core/lib/blob";
import { verifyOrgKeyable } from "../trust";
import { clearVoidedPendingEnvUpdatesProducer } from ".";
import { log } from "@core/lib/utils/logger";

export const decryptEnvs = async (
    state: Client.State,
    encryptedKeys: Blob.UserEncryptedKeysByEnvironmentIdOrComposite,
    encryptedBlobs: Blob.UserEncryptedBlobsByEnvironmentIdOrComposite,
    currentUserPrivkey: Crypto.Privkey,
    context: Client.Context
  ) => {
    const toVerifyKeyableIds = new Set<string>(),
      toDecryptKeys: [string, Parameters<typeof decrypt>[0]][] = [];

    for (let compositeId in encryptedKeys) {
      const encryptedKey = encryptedKeys[compositeId],
        encryptedBy = state.graph[encryptedKey.encryptedById] as
          | Model.CliUser
          | Model.OrgUserDevice
          | undefined;

      if (!encryptedBy || !encryptedBy.pubkey) {
        throw new Error("encryptedById not found in graph OR missing pubkey");
      }

      toVerifyKeyableIds.add(encryptedKey.encryptedById);

      toDecryptKeys.push([
        compositeId,
        {
          encrypted: encryptedKey.data,
          pubkey: encryptedBy.pubkey,
          privkey: currentUserPrivkey,
        },
      ]);
    }

    // verify all keyables
    await Promise.all(
      Array.from(toVerifyKeyableIds).map((keyableId) =>
        verifyOrgKeyable(state, keyableId, context)
      )
    );

    // decrypt all
    const missingBlobs = R.difference(
      Object.keys(encryptedKeys),
      Object.keys(encryptedBlobs)
    );
    if (missingBlobs.length) {
      log("missing blobs:", missingBlobs);
      throw new Error("Missing blob keys");
    }

    const missingKeys = R.difference(
      Object.keys(encryptedBlobs),
      Object.keys(encryptedKeys)
    );
    if (missingKeys.length) {
      log("missing encrypted keys:", missingKeys);
      throw new Error("Missing encrypted keys");
    }

    const decryptRes = await Promise.all(
      toDecryptKeys.map(([compositeId, params]) =>
        decrypt(params).then((decryptedKey) => {
          const encryptedBlob = encryptedBlobs[compositeId];

          if (!encryptedBlob) {
            log("missing encryptedBlob", { compositeId, decryptedKey });

            throw new Error("Missing encrypted blob");
          }

          return decryptSymmetricWithKey({
            encrypted: encryptedBlob.data,
            encryptionKey: decryptedKey,
          }).then((decryptedBlob) => {
            const env = JSON.parse(decryptedBlob);

            return {
              [compositeId]: {
                key: decryptedKey,
                env,
              },
            };
          });
        })
      )
    );

    const res = R.mergeAll(decryptRes) as Client.State["envs"];

    return res;
  },
  decryptChangesets = async (
    state: Client.State,
    encryptedKeyArrays: Blob.UserEncryptedChangesetKeysByEnvironmentId,
    encryptedBlobs: Blob.UserEncryptedBlobsByEnvironmentIdOrComposite,
    currentUserPrivkey: Crypto.Privkey,
    context: Client.Context
  ) => {
    const toVerifyKeyableIds = new Set<string>(),
      toDecryptKeys: [
        {
          environmentId: string;
          id: string;
          createdAt: number;
          encryptedById: string;
          createdById: string;
        },
        Parameters<typeof decrypt>[0]
      ][] = [];

    for (let environmentId in encryptedKeyArrays) {
      const encryptedKeys = encryptedKeyArrays[environmentId];

      for (let encryptedKey of encryptedKeys) {
        const encryptedBy = state.graph[encryptedKey.encryptedById] as
          | Model.CliUser
          | Model.OrgUserDevice
          | undefined;

        if (!encryptedBy || !encryptedBy.pubkey) {
          throw new Error("encryptedById not found in graph OR missing pubkey");
        }

        toVerifyKeyableIds.add(encryptedKey.encryptedById);

        toDecryptKeys.push([
          {
            environmentId,
            id: encryptedKey.changesetId!,
            createdAt: encryptedKey.createdAt,
            encryptedById: encryptedKey.encryptedById,
            createdById: encryptedKey.createdById!,
          },
          {
            encrypted: encryptedKey.data,
            pubkey: encryptedBy.pubkey,
            privkey: currentUserPrivkey,
          },
        ]);
      }
    }

    // verify all keyables
    await Promise.all(
      Array.from(toVerifyKeyableIds).map((keyableId) =>
        verifyOrgKeyable(state, keyableId, context)
      )
    );

    // decrypt all
    const decryptRes = (await Promise.all(
      toDecryptKeys.map(
        ([
          { environmentId, createdAt, createdById, id, encryptedById },
          params,
        ]) =>
          decrypt(params).then((decryptedKey) => {
            const encryptedBlob = encryptedBlobs[[environmentId, id].join("|")];

            if (!encryptedBlob) {
              throw new Error(
                "encrypted blob not found for key: " +
                  JSON.stringify({ environmentId, id })
              );
            }

            return decryptSymmetricWithKey({
              encryptionKey: decryptedKey,
              encrypted: encryptedBlob.data,
            }).then((decryptedBlob) => ({
              [environmentId]: [
                {
                  key: decryptedKey,
                  changesets: (
                    JSON.parse(decryptedBlob) as Client.Env.ChangesetPayload[]
                  ).map(
                    (changesetPayload) =>
                      ({
                        ...changesetPayload,
                        createdAt,
                        encryptedById,
                        createdById,
                        id,
                      } as Client.Env.Changeset)
                  ),
                },
              ],
            }));
          })
      )
    )) as Client.State["changesets"][];

    return decryptRes.reduce((agg, changesetsByEnvironmentId) => {
      for (let environmentId in changesetsByEnvironmentId) {
        if (agg[environmentId]) {
          agg[environmentId].push(...changesetsByEnvironmentId[environmentId]);
        } else {
          agg[environmentId] = [...changesetsByEnvironmentId[environmentId]];
        }
      }
      return agg;
    }, {} as Client.State["changesets"]);
  },
  decryptedEnvsStateProducer = (
    draft: Draft<Client.State>,
    action: {
      payload: Partial<Pick<Client.State, "envs" | "changesets">> & {
        timestamp: number;
        recentChangesets?: true;
        changesetOptions?: Api.Net.FetchChangesetOptions;
      };
    }
  ) => {
    if (action.payload.envs) {
      for (let composite in action.payload.envs) {
        const { environmentId } =
          parseUserEncryptedKeyOrBlobComposite(composite);
        let envParentId: string;
        const environment = draft.graph[environmentId] as
          | Model.Environment
          | undefined;
        if (environment) {
          envParentId = environment.envParentId;
        } else {
          [envParentId] = environmentId.split("|");
        }

        const envParent = draft.graph[envParentId] as Model.EnvParent;

        if (envParent.envsOrLocalsUpdatedAt) {
          draft.envsFetchedAt[envParentId] = envParent.envsOrLocalsUpdatedAt;
        }

        draft.envs[composite] = action.payload.envs[composite];
      }

      clearVoidedPendingEnvUpdatesProducer(draft);
    }

    if (action.payload.changesets) {
      for (let environmentId in action.payload.changesets) {
        let envParentId: string;
        const environment = draft.graph[environmentId] as
          | Model.Environment
          | undefined;
        if (environment) {
          envParentId = environment.envParentId;
        } else {
          [envParentId] = environmentId.split("|");
        }

        if (action.payload.recentChangesets) {
          delete draft.changesetsFetchedAt[envParentId];
        } else {
          draft.changesetsFetchedAt[envParentId] = action.payload.timestamp;
        }

        draft.changesets[environmentId] =
          action.payload.changesets[environmentId];
      }
    }
  };

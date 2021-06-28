import produce, { Draft } from "immer";
import * as R from "ramda";
import { Client, Api, Model, Blob, Crypto, Graph } from "@core/types";
import {
  getCurrentEncryptedKeys,
  getConnectedBlockEnvironmentsForApp,
} from "@core/lib/graph";
import {
  keySetDifference,
  getUserEncryptedKeyOrBlobComposite,
  parseUserEncryptedKeyOrBlobComposite,
} from "@core/lib/blob";
import { encrypt, signJson } from "@core/lib/crypto";
import { verifyOrgKeyable } from "../trust";
import {
  getTrustChain,
  getAuth,
  getInheritanceOverrides,
} from "@core/lib/client";
import { log } from "@core/lib/utils/logger";

export const keySetForGraphProposal = (
    graph: Client.Graph.UserGraph,
    now: number,
    producer: (
      graphDraft: Draft<Client.Graph.UserGraph>
    ) => void | Client.Graph.UserGraph
  ): Blob.KeySet => {
    const currentKeys = getCurrentEncryptedKeys(graph, "all", now),
      proposedGraph = produce(graph, producer),
      proposedKeys = getCurrentEncryptedKeys(proposedGraph, "all", now),
      diff = keySetDifference(proposedKeys, currentKeys);

    return diff;
  },
  requiredEnvsForKeySet = (
    graph: Client.Graph.UserGraph,
    toSet: Blob.KeySet
  ) => {
    const requiredEnvs = new Set<string>(),
      requiredChangesets = new Set<string>();

    if (toSet.users) {
      for (let userId in toSet.users) {
        for (let deviceId in toSet.users[userId]) {
          const deviceToSet = toSet.users[userId][deviceId];
          for (let envParentId in deviceToSet) {
            const { environments, locals } = deviceToSet[envParentId];

            if (environments) {
              for (let environmentId in environments) {
                const environmentToSet = environments[environmentId];
                if (
                  environmentToSet.env ||
                  environmentToSet.meta ||
                  environmentToSet.inherits
                ) {
                  requiredEnvs.add(envParentId);
                }
                if (environmentToSet.changesets) {
                  requiredChangesets.add(envParentId);
                }
              }
            }

            if (locals) {
              requiredEnvs.add(envParentId);
            }
          }
        }
      }
    }

    if (toSet.blockKeyableParents) {
      for (let blockId in toSet.blockKeyableParents) {
        requiredEnvs.add(blockId);
      }
    }

    if (toSet.keyableParents) {
      for (let keyableParentId in toSet.keyableParents) {
        const keyableParent = graph[keyableParentId] as Model.KeyableParent;
        requiredEnvs.add(keyableParent.appId);
      }
    }

    return {
      requiredEnvs,
      requiredChangesets,
    };
  },
  encryptedKeyParamsForKeySet = async (params: {
    state: Client.State;
    context: Client.Context;
    toSet: Blob.KeySet;
  }) => {
    const { state, context, toSet } = params,
      currentAuth = getAuth(state, context.accountIdOrCliKey);
    if (!currentAuth || !currentAuth.privkey) {
      throw new Error("Action requires authentication and decrypted privkey");
    }

    const privkey = currentAuth.privkey,
      toVerifyKeyableIds = new Set<string>(),
      toEncrypt: [string[], Parameters<typeof encrypt>[0]][] = [],
      toSetAdditionalPaths: [string[], any][] = [],
      inheritanceOverridesByEnvironmentId = R.groupBy(
        ([composite]) =>
          parseUserEncryptedKeyOrBlobComposite(composite).environmentId,
        R.toPairs(state.envs).filter(
          ([composite]) =>
            parseUserEncryptedKeyOrBlobComposite(composite)
              .inheritsEnvironmentId
        )
      );

    let keys = {} as Api.Net.EnvParams["keys"];

    if (toSet.users) {
      for (let userId in toSet.users) {
        const user = state.graph[userId] as Model.OrgUser | Model.CliUser;
        if (user.type == "cliUser") {
          toVerifyKeyableIds.add(userId);
        }

        for (let deviceId in toSet.users[userId]) {
          let pubkey: Crypto.Pubkey;

          if (deviceId == "cli" && user.type == "cliUser") {
            pubkey = user.pubkey;
          } else {
            pubkey = (
              state.graph[deviceId] as
                | Model.OrgUserDevice
                | Model.Invite
                | Model.DeviceGrant
            ).pubkey!;
            toVerifyKeyableIds.add(deviceId);
          }

          const deviceToSet = toSet.users[userId][deviceId];

          for (let envParentId in deviceToSet) {
            const { environments, locals } = deviceToSet[envParentId];

            if (environments) {
              for (let environmentId in environments) {
                const environmentToSet = environments[environmentId];

                if (environmentToSet.env) {
                  const key =
                    state.envs[
                      getUserEncryptedKeyOrBlobComposite({ environmentId })
                    ]?.key;
                  if (key) {
                    toEncrypt.push([
                      [
                        "users",
                        userId,
                        deviceId,
                        envParentId,
                        "environments",
                        environmentId,
                        "env",
                      ],
                      {
                        data: key,
                        pubkey,
                        privkey,
                      },
                    ]);
                  }
                }
                if (environmentToSet.meta) {
                  const key =
                    state.envs[
                      getUserEncryptedKeyOrBlobComposite({
                        environmentId,
                        envPart: "meta",
                      })
                    ]?.key;
                  if (key) {
                    toEncrypt.push([
                      [
                        "users",
                        userId,
                        deviceId,
                        envParentId,
                        "environments",
                        environmentId,
                        "meta",
                      ],
                      {
                        data: key,
                        pubkey,
                        privkey,
                      },
                    ]);
                  }
                }
                if (environmentToSet.inherits) {
                  const key =
                    state.envs[
                      getUserEncryptedKeyOrBlobComposite({
                        environmentId,
                        envPart: "inherits",
                      })
                    ]?.key;

                  if (key) {
                    toEncrypt.push([
                      [
                        "users",
                        userId,
                        deviceId,
                        envParentId,
                        "environments",
                        environmentId,
                        "inherits",
                      ],
                      {
                        data: key,
                        pubkey,
                        privkey,
                      },
                    ]);
                  }
                }

                if (environmentToSet.changesets) {
                  for (let { key, changesets } of state.changesets[
                    environmentId
                  ] ?? []) {
                    for (let changeset of changesets) {
                      const path = [
                        "users",
                        userId,
                        deviceId,
                        envParentId,
                        "environments",
                        environmentId,
                        "changesetsById",
                        changeset.id,
                      ];

                      toEncrypt.push([
                        [...path, "data"],
                        {
                          data: key,
                          pubkey,
                          privkey,
                        },
                      ]);

                      toSetAdditionalPaths.push([
                        [...path, "createdAt"],
                        changeset.createdAt,
                      ]);

                      toSetAdditionalPaths.push([
                        [...path, "createdById"],
                        changeset.createdById,
                      ]);
                    }
                  }
                }

                // inheritance overrides
                if (environmentToSet.env) {
                  const environmentInheritanceOverrides =
                    inheritanceOverridesByEnvironmentId[environmentId] ?? [];

                  for (let [
                    composite,
                    { key },
                  ] of environmentInheritanceOverrides) {
                    const { inheritsEnvironmentId } =
                      parseUserEncryptedKeyOrBlobComposite(composite);

                    toEncrypt.push([
                      [
                        "users",
                        userId,
                        deviceId,
                        envParentId,
                        "environments",
                        environmentId,
                        "inheritanceOverrides",
                        inheritsEnvironmentId!,
                      ],
                      {
                        data: key,
                        pubkey,
                        privkey,
                      },
                    ]);
                  }
                }
              }
            }

            if (locals) {
              for (let localsUserId in locals) {
                const environmentId = [envParentId, localsUserId].join("|");

                const localsToSet = locals[localsUserId];
                if (localsToSet.env) {
                  const key =
                    state.envs[
                      getUserEncryptedKeyOrBlobComposite({
                        environmentId,
                      })
                    ]?.key;

                  if (key) {
                    toEncrypt.push([
                      [
                        "users",
                        userId,
                        deviceId,
                        envParentId,
                        "locals",
                        localsUserId,
                        "env",
                      ],
                      {
                        data: key,
                        pubkey,
                        privkey,
                      },
                    ]);
                  }
                }

                if (localsToSet.meta) {
                  const key =
                    state.envs[
                      getUserEncryptedKeyOrBlobComposite({
                        environmentId,
                        envPart: "meta",
                      })
                    ]?.key;

                  if (key) {
                    toEncrypt.push([
                      [
                        "users",
                        userId,
                        deviceId,
                        envParentId,
                        "locals",
                        localsUserId,
                        "meta",
                      ],
                      {
                        data: key,
                        pubkey,
                        privkey,
                      },
                    ]);
                  }
                }

                if (localsToSet.changesets) {
                  for (let { key, changesets } of state.changesets[
                    [envParentId, localsUserId].join("|")
                  ] ?? []) {
                    for (let changeset of changesets) {
                      const path = [
                        "users",
                        userId,
                        deviceId,
                        envParentId,
                        "locals",
                        localsUserId,
                        "changesetsById",
                        changeset.id,
                      ];

                      toEncrypt.push([
                        [...path, "data"],
                        {
                          data: key,
                          pubkey,
                          privkey,
                        },
                      ]);

                      toSetAdditionalPaths.push([
                        [...path, "createdAt"],
                        changeset.createdAt,
                      ]);

                      toSetAdditionalPaths.push([
                        [...path, "createdById"],
                        changeset.createdById,
                      ]);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    if (toSet.keyableParents) {
      for (let keyableParentId in toSet.keyableParents) {
        toVerifyKeyableIds.add(keyableParentId);

        const keyableParent = state.graph[
            keyableParentId
          ] as Model.KeyableParent,
          environment = state.graph[
            keyableParent.environmentId
          ] as Model.Environment;

        let inheritanceOverrides = getInheritanceOverrides(state, {
          envParentId: keyableParent.appId,
          environmentId: environment.id,
        });
        // for sub-environment, also include parent environment overrides
        if (environment.isSub) {
          inheritanceOverrides = R.mergeDeepRight(
            getInheritanceOverrides(state, {
              envParentId: keyableParent.appId,
              environmentId: environment.parentEnvironmentId,
            }),
            inheritanceOverrides
          ) as typeof inheritanceOverrides;
        }

        const generatedEnvkeyId = Object.keys(
            toSet.keyableParents[keyableParentId]
          )[0],
          generatedEnvkey = state.graph[
            generatedEnvkeyId
          ] as Model.GeneratedEnvkey,
          envkeyToSet =
            toSet.keyableParents[keyableParentId][generatedEnvkeyId];

        if (envkeyToSet.env) {
          const composite = getUserEncryptedKeyOrBlobComposite({
            environmentId: environment.isSub
              ? environment.parentEnvironmentId
              : environment.id,
          });
          const key = state.envs[composite]?.key;

          if (key) {
            toEncrypt.push([
              [
                "keyableParents",
                keyableParent.id,
                generatedEnvkey.id,
                "env",
                "data",
              ],
              {
                data: key,
                pubkey: generatedEnvkey.pubkey,
                privkey,
              },
            ]);
          }
        }

        if (envkeyToSet.subEnv) {
          const key =
            state.envs[
              getUserEncryptedKeyOrBlobComposite({
                environmentId: environment.id,
              })
            ]?.key;
          if (key) {
            toEncrypt.push([
              [
                "keyableParents",
                keyableParent.id,
                generatedEnvkey.id,
                "subEnv",
                "data",
              ],
              {
                data: key,
                pubkey: generatedEnvkey.pubkey,
                privkey,
              },
            ]);
          }
        }

        if (envkeyToSet.localOverrides && keyableParent.type == "localKey") {
          const key =
            state.envs[
              getUserEncryptedKeyOrBlobComposite({
                environmentId: [keyableParent.appId, keyableParent.userId].join(
                  "|"
                ),
              })
            ]?.key;

          if (key) {
            toEncrypt.push([
              [
                "keyableParents",
                keyableParent.id,
                generatedEnvkey.id,
                "localOverrides",
                "data",
              ],
              {
                data: key,

                pubkey: generatedEnvkey.pubkey,
                privkey,
              },
            ]);
          }
        }

        // inheritance overrides
        if (!R.isEmpty(inheritanceOverrides)) {
          for (let inheritanceOverridesEnvironmentId in inheritanceOverrides) {
            const composite = getUserEncryptedKeyOrBlobComposite({
              environmentId: inheritanceOverridesEnvironmentId,
              inheritsEnvironmentId: keyableParent.environmentId,
            });

            toEncrypt.push([
              [
                "keyableParents",
                keyableParent.id,
                generatedEnvkey.id,
                "inheritanceOverrides",
                inheritanceOverridesEnvironmentId,
                "data",
              ],
              {
                data: state.envs[composite].key,
                pubkey: generatedEnvkey.pubkey,
                privkey,
              },
            ]);
          }
        }
      }
    }

    if (toSet.blockKeyableParents) {
      for (let blockId in toSet.blockKeyableParents) {
        for (let keyableParentId in toSet.blockKeyableParents[blockId]) {
          toVerifyKeyableIds.add(keyableParentId);

          const keyableParent = state.graph[
              keyableParentId
            ] as Model.KeyableParent,
            appEnvironment = state.graph[
              keyableParent.environmentId
            ] as Model.Environment,
            blockEnvironment = getConnectedBlockEnvironmentsForApp(
              state.graph,
              keyableParent.appId,
              blockId,
              appEnvironment.id
            )[0];

          let inheritanceOverrides = getInheritanceOverrides(state, {
            envParentId: blockId,
            environmentId: blockEnvironment.id,
          });
          // for sub-environment, also include parent environment overrides
          if (blockEnvironment.isSub) {
            inheritanceOverrides = R.mergeDeepRight(
              getInheritanceOverrides(state, {
                envParentId: blockId,
                environmentId: blockEnvironment.parentEnvironmentId,
              }),
              inheritanceOverrides
            ) as typeof inheritanceOverrides;
          }

          const generatedEnvkeyId = Object.keys(
              toSet.blockKeyableParents[blockId][keyableParentId]
            )[0],
            generatedEnvkey = state.graph[
              generatedEnvkeyId
            ] as Model.GeneratedEnvkey,
            envkeyToSet =
              toSet.blockKeyableParents[blockId][keyableParentId][
                generatedEnvkeyId
              ];

          if (envkeyToSet.env) {
            const key =
              state.envs[
                getUserEncryptedKeyOrBlobComposite({
                  environmentId: blockEnvironment.isSub
                    ? blockEnvironment.parentEnvironmentId
                    : blockEnvironment.id,
                })
              ]?.key;

            if (key) {
              toEncrypt.push([
                [
                  "blockKeyableParents",
                  blockId,
                  keyableParent.id,
                  generatedEnvkey.id,
                  "env",
                  "data",
                ],
                {
                  data: key,
                  pubkey: generatedEnvkey.pubkey,
                  privkey,
                },
              ]);
            }
          }

          if (envkeyToSet.subEnv && blockEnvironment.isSub) {
            const key =
              state.envs[
                getUserEncryptedKeyOrBlobComposite({
                  environmentId: blockEnvironment.id,
                })
              ]?.key;
            if (key) {
              toEncrypt.push([
                [
                  "blockKeyableParents",
                  blockId,
                  keyableParent.id,
                  generatedEnvkey.id,
                  "subEnv",
                  "data",
                ],
                {
                  data: key,
                  pubkey: generatedEnvkey.pubkey,
                  privkey,
                },
              ]);
            }
          }

          if (envkeyToSet.localOverrides && keyableParent.type == "localKey") {
            const key =
              state.envs[
                getUserEncryptedKeyOrBlobComposite({
                  environmentId: [blockId, keyableParent.userId].join("|"),
                })
              ]?.key;

            if (key) {
              toEncrypt.push([
                [
                  "blockKeyableParents",
                  blockId,
                  keyableParent.id,
                  generatedEnvkey.id,
                  "localOverrides",
                  "data",
                ],
                {
                  data: key,
                  pubkey: generatedEnvkey.pubkey,
                  privkey,
                },
              ]);
            }
          }

          // inheritance overrides
          if (!R.isEmpty(inheritanceOverrides)) {
            for (let inheritanceOverridesEnvironmentId in inheritanceOverrides) {
              const composite = getUserEncryptedKeyOrBlobComposite({
                environmentId: blockEnvironment.id,
                inheritsEnvironmentId: inheritanceOverridesEnvironmentId,
              });

              const key = state.envs[composite]?.key;

              if (!key) {
                throw new Error("Missing inheritance overrides key");
              }

              toEncrypt.push([
                [
                  "blockKeyableParents",
                  blockId,
                  keyableParent.id,
                  generatedEnvkey.id,
                  "inheritanceOverrides",
                  inheritanceOverridesEnvironmentId,
                  "data",
                ],
                {
                  data: key,
                  pubkey: generatedEnvkey.pubkey,
                  privkey,
                },
              ]);
            }
          }
        }
      }
    }

    // verify all keyables
    await Promise.all(
      Array.from(toVerifyKeyableIds).map((keyableId) =>
        verifyOrgKeyable(state, keyableId, context)
      )
    );

    const cryptoPromises = toEncrypt.map(([path, params]) =>
        encrypt(params).then((encrypted) => [path, encrypted])
      ) as Promise<[string[], Crypto.EncryptedData]>[],
      pathResults = await Promise.all(cryptoPromises);

    for (let [path, data] of pathResults) {
      keys = R.assocPath(path, data, keys);
    }

    for (let [path, val] of toSetAdditionalPaths) {
      keys = R.assocPath(path, val, keys);
    }

    let encryptedByTrustChain: string | undefined;
    const hasKeyables =
      Object.keys(toSet.keyableParents ?? {}).length +
        Object.keys(toSet.blockKeyableParents ?? {}).length >
      0;
    if (hasKeyables) {
      const trustChain = getTrustChain(state, context.accountIdOrCliKey);
      encryptedByTrustChain = await signJson({
        data: trustChain,
        privkey,
      });
    }

    return {
      keys,
      blobs: {},
      encryptedByTrustChain: encryptedByTrustChain
        ? { data: encryptedByTrustChain }
        : undefined,
    } as Api.Net.EnvParams;
  };

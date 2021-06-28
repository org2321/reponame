import { log, logStderr } from "@core/lib/utils/logger";
import { env } from "./env";
import S3 from "aws-sdk/clients/s3";
import * as R from "ramda";
import { Api } from "@core/types";
import { query, updateDbStatement, executeTransactionStatements } from "./db";
import { getFetchResponse, getHandlerContext, getTargetIds } from "./fetch";
import {
  getLogTransactionStatement,
  getLogsWithTransactionIds,
} from "./models/logs";
import { s3LogKeyToParts, S3LogKeyParts, getS3LogKey } from "./models/s3_logs";
import { graphTypes } from "@core/lib/graph";
import { pick } from "@core/lib/utils/pick";
import {
  getScope,
  getGeneratedEnvkeyEncryptedKeyOrBlobComposite,
} from "@core/lib/blob";

const FAILOVER_LOGS_INTERVAL = env.FAILOVER_LOGS_INTERVAL
    ? parseInt(env.FAILOVER_LOGS_INTERVAL) * 1000
    : 1000 * 60 * 19, // 19 minutes default (plus random 0-60s for staggering with multiple procs),
  MAX_S3_DELETE_ITEMS = 1000,
  MAX_CONCURRENT_REQUESTS = 100,
  s3 = new S3({ region: process.env.AWS_REGION });

export const replicateIfNeeded = async (
    org: Api.Db.Org,
    updatedOrgGraph: Api.Graph.OrgGraph,
    now: number
  ) => {
    if (env.NODE_ENV != "production") {
      return;
    }

    const generatedEnvkeys = graphTypes(updatedOrgGraph)
        .generatedEnvkeys as Api.Db.GeneratedEnvkey[],
      toReplicate = generatedEnvkeys.filter(
        ({ deletedAt, blobsUpdatedAt }) =>
          (deletedAt && deletedAt > org.replicatedAt) ||
          blobsUpdatedAt > org.replicatedAt
      );

    if (!toReplicate.length) {
      log(
        `Org ${org.id} has no ENVKEYs that need replication, out of ${generatedEnvkeys.length}.`
      );
      return;
    }

    log(`ENVKEYs to replicate to S3...`, {
      org: org.id,
      toReplicate: toReplicate.length,
      generatedEnvkeys: generatedEnvkeys.length,
      bucket: env.FAILOVER_BUCKET,
    });

    const [allEncryptedKeys, allRootPubkeyReplacements] = await Promise.all([
      query<Api.Db.GeneratedEnvkeyEncryptedKey>({
        pkey: generatedEnvkeys.map(R.prop("envkeyIdPart")),
      }),
      query<Api.Db.RootPubkeyReplacement>({
        pkey: org.id,
        scope: "g|rootPubkeyReplacement",
        sortBy: "createdAt",
      }),
    ]);

    const blobScopes = R.uniq(
      allEncryptedKeys.map(
        (encryptedKey) =>
          getScope({
            blobType: "env",
            envParentId: encryptedKey.blockId ?? encryptedKey.envParentId,
            environmentId: encryptedKey.environmentId,
          })!
      )
    );

    const allEncryptedBlobs = await query<Api.Db.EncryptedBlob>({
      pkey: org.id,
      scope: blobScopes,
    });

    const encryptedBlobsByComposite = R.indexBy(
      getGeneratedEnvkeyEncryptedKeyOrBlobComposite,
      allEncryptedBlobs
    );

    const encryptedKeysByGeneratedEnvkeyId = R.groupBy(
        R.prop("generatedEnvkeyId"),
        allEncryptedKeys
      ),
      deleteKeys: string[] = [],
      s3Promises: Promise<any>[] = [];

    for (let generatedEnvkey of generatedEnvkeys) {
      if (generatedEnvkey.deletedAt) {
        deleteKeys.push(generatedEnvkey.envkeyIdPart);
        continue;
      }
      const encryptedKeys =
        encryptedKeysByGeneratedEnvkeyId[generatedEnvkey.id];

      if (encryptedKeys && encryptedKeys.length) {
        s3Promises.push(
          s3
            .putObject({
              Bucket: env.FAILOVER_BUCKET,
              Key: generatedEnvkey.envkeyIdPart,
              Body: JSON.stringify(
                getFetchResponse(
                  generatedEnvkey,
                  encryptedKeys,
                  encryptedBlobsByComposite,
                  allRootPubkeyReplacements.filter(
                    (replacement) =>
                      !replacement.deletedAt &&
                      replacement.processedAtById[generatedEnvkey.id] === false
                  )
                )
              ),
            })
            .promise()
        );
      } else {
        deleteKeys.push(generatedEnvkey.envkeyIdPart);
      }
    }

    if (deleteKeys.length > 0) {
      const deletePromises = R.splitEvery(
        MAX_S3_DELETE_ITEMS,
        deleteKeys
      ).flatMap((keys) =>
        s3
          .deleteObjects({
            Bucket: env.FAILOVER_BUCKET,
            Delete: { Objects: keys.map((key) => ({ Key: key })) },
          })
          .promise()
      );
      s3Promises.push(...deletePromises);
    }

    try {
      for (let batch of R.splitEvery(MAX_CONCURRENT_REQUESTS, s3Promises)) {
        await Promise.all(batch);
      }

      log(`Org ${org.id} replication complete`);

      await executeTransactionStatements([
        updateDbStatement(pick(["pkey", "skey"], org), {
          ...updatedOrgGraph[org.id],
          replicatedAt: now,
        } as Api.Db.Org),
      ]);
    } catch (err) {
      logStderr("replication ERROR:", { err, orgId: org.id });
      throw err;
    }
  },
  failoverLogsLoop = async (marker?: S3.ListObjectsOutput["Marker"]) => {
    log("Checking failover logs...");

    const delay = FAILOVER_LOGS_INTERVAL + Math.round(Math.random() * 60000);

    let res: S3.ListObjectsOutput | undefined;
    res = await s3
      .listObjects({
        Bucket: env.LOGS_BUCKET,
        Marker: marker,
      })
      .promise()
      .catch((err) => {
        logStderr("S3 failover logs problem:", {
          err,
          bucket: env.LOGS_BUCKET,
        });
        return undefined;
      });

    if (!res) {
      log(
        `Error listing log bucket objects. Will check again in ${
          delay / 1000
        } seconds...`
      );
      setTimeout(failoverLogsLoop, delay);
      return;
    }

    if (!res.Contents || !res.Contents.length) {
      log(
        `No failover logs found. Will check again in ${delay / 1000} seconds...`
      );
      setTimeout(failoverLogsLoop, delay);
      return;
    }

    // for idempotency, ensure none of these logs have already been inserted
    const withValidatedKeys = res.Contents.map(({ Key }) => {
      try {
        return s3LogKeyToParts(Key!);
      } catch (ignored) {
        log("Skipping replicated log object with unexpected key", { Key });
        return;
      }
    }).filter(Boolean) as S3LogKeyParts[];

    let filteredContents = withValidatedKeys;

    const transactionIds = filteredContents.map(R.prop("transactionId"));
    const existingLogs = await getLogsWithTransactionIds(transactionIds);
    const existingTransactionIds = new Set(
      existingLogs.map(R.prop("transactionId"))
    );

    filteredContents =
      existingTransactionIds.size > 0
        ? filteredContents.filter(({ transactionId }) => {
            return !existingTransactionIds.has(transactionId);
          })
        : filteredContents;

    const envkeyIdParts = R.uniq(filteredContents.map(R.prop("envkeyIdPart")));

    log("Ingesting failover logs for ENVKEYs...", {
      envkeyIdParts: envkeyIdParts.length,
    });

    const [generatedEnvkeys, allEncryptedKeys] = await Promise.all([
        query<Api.Db.GeneratedEnvkey>({
          scope: envkeyIdParts.map((idPart) =>
            ["g", "generatedEnvkey", idPart].join("|")
          ),
        }),

        query<Api.Db.GeneratedEnvkeyEncryptedKey>({
          pkey: envkeyIdParts,
          omitData: true,
        }),
      ]),
      encryptedKeysByEnvkeyIdPart = R.groupBy(R.prop("pkey"), allEncryptedKeys),
      generatedEnvkeysByEnvkeyIdPart = R.indexBy(
        R.prop("envkeyIdPart"),
        generatedEnvkeys
      );

    const promises: Promise<Api.Db.SqlStatement | null>[] = [];

    for (const obj of filteredContents) {
      const Key = getS3LogKey(obj);
      promises.push(
        s3
          .getObject({
            Bucket: env.LOGS_BUCKET,
            Key,
          })
          .promise()
          .then((objRes) => {
            let action: Api.Action.RequestActions["FetchEnvkey"] | undefined;
            try {
              const actionPlain = JSON.parse(objRes?.Body?.toString("utf8")!);
              action = Api.Action.FetchEnvkeyActionSchema.parse(actionPlain);
              if (!action) {
                return null;
              }
            } catch (err) {
              logStderr("Replicated log JSON is unexpected format", {
                Key,
                objRes,
              });
              return null;
            }

            const generatedEnvkey =
                generatedEnvkeysByEnvkeyIdPart[obj.envkeyIdPart],
              encryptedKeys = encryptedKeysByEnvkeyIdPart[obj.envkeyIdPart];

            return getLogTransactionStatement({
              action,
              transactionId: obj.transactionId,
              ip: obj.ip,
              response: { type: "fetchResult" } as Api.Net.ApiResult,
              responseBytes: obj.contentLength,
              now: obj.timestamp,
              handlerContext: getHandlerContext(generatedEnvkey, encryptedKeys),
              targetIds: getTargetIds(generatedEnvkey, encryptedKeys),
            });
          })
          .catch((err) => {
            logStderr("Replicated log fetch from S3 crash, skipping.", {
              err,
              Key,
            });
            return null;
          })
      );
    }

    const statements = (await Promise.all(promises)).filter(
      Boolean
    ) as Api.Db.SqlStatement[];
    log(`Committing ${statements.length} failover logs to db...`);
    await executeTransactionStatements(statements);

    log(
      `Log ingestion complete. Now deleting ${withValidatedKeys.length} failover logs from S3...`
    );

    try {
      const { Deleted } = await s3
        .deleteObjects({
          Bucket: env.LOGS_BUCKET,
          Delete: {
            Objects: withValidatedKeys.map((obj) => ({
              Key: getS3LogKey(obj),
            })),
          },
        })
        .promise();
      log(
        `Deleted ${Deleted?.length} s3 log objects. Will check again in ${
          delay / 1000
        } secs`
      );
    } catch (err) {
      logStderr(
        `Error deleting S3 failover logs, will check again in ${
          delay / 1000
        } secs`,
        err
      );
    }

    // If the bucket list object request still has additional pages, continue processing immediately.
    // Otherwise, continue with timeout loop.
    if (res.NextMarker) {
      failoverLogsLoop(res!.NextMarker);
    } else {
      setTimeout(failoverLogsLoop, delay);
    }
  };

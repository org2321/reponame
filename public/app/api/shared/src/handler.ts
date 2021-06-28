import { clearOrphanedRootPubkeyReplacements } from "./models/crypto";
import { log, logWithElapsed, logStderr } from "@core/lib/utils/logger";
import { getLogTransactionStatement } from "./models/logs";
import { createPatch } from "rfc6902";
import { Api, Client, Auth, Crypto, Blob, Rbac, Awaited } from "@core/types";
import { authenticate, authorizeEnvsUpdate } from "./auth";
import * as R from "ramda";
import {
  pool,
  objectTransactionItemsEmpty,
  mergeObjectTransactionItems,
  objectTransactionStatements,
  executeTransactionStatements,
} from "./db";
import { env } from "./env";
import {
  getGraphTransactionItems,
  getOrgGraph,
  getApiUserGraph,
  clearOrphanedLocals,
  getAccessUpdated,
} from "./graph";
import {
  getCurrentEncryptedKeys,
  deleteExpiredAuthObjects,
  graphTypes,
} from "@core/lib/graph";
import { keySetDifference, keySetEmpty } from "@core/lib/blob";
import {
  getDeleteEncryptedKeysTransactionItems,
  getEnvParamsTransactionItems,
  getEnvEncryptedKeys,
  getChangesetEncryptedKeys,
  requireEncryptedKeys,
  queueBlobsForReencryptionIfNeeded,
  getReorderEncryptedKeysTransactionItems,
  getEnvEncryptedBlobs,
  getChangesetEncryptedBlobs,
} from "./blob";
import { pick } from "@core/lib/utils/pick";
import { v4 as uuid } from "uuid";
import { PoolConnection } from "mysql2/promise";
import { replicateIfNeeded } from "./replication";

type ApiActionConfig = Api.ApiActionParams<
  Api.Action.RequestAction,
  Api.Net.ApiResult
>;

export const apiAction = <
    ActionType extends Api.Action.RequestAction,
    ResponseType extends Api.Net.ApiResult,
    AuthContextType extends Auth.AuthContext = Auth.DefaultAuthContext
  >(
    apiAction: Api.ApiActionParams<ActionType, ResponseType, AuthContextType>
  ) => {
    if (apiActions[apiAction.type]) {
      throw new Api.ApiError(
        "Api Action with this type was already defined",
        500
      );
    }

    apiActions[apiAction.type] = apiAction as Api.ApiActionParams<
      Api.Action.RequestAction,
      ResponseType
    >;
  },
  registerSocketServer = (server: Api.SocketServer) => (socketServer = server),
  handleAction = async (
    action: Api.Action.RequestAction | Api.Action.BulkGraphAction,
    requestParams: Api.RequestParams
  ): Promise<Api.Net.ApiResult> => {
    const transactionId = uuid();
    const bytes = Buffer.byteLength(JSON.stringify(action), "utf8");

    log("Received action " + action.type, { bytes, transactionId });

    const isFetchAction =
      action.type == Api.ActionType.FETCH_ENVKEY ||
      action.type == Api.ActionType.ENVKEY_FETCH_UPDATE_TRUSTED_ROOT_PUBKEY;

    if (
      (env.SERVER_MODE == "api_only" && isFetchAction) ||
      (env.SERVER_MODE == "fetch_only" && !isFetchAction)
    ) {
      throw new Api.ApiError("Action type not allowed for server mode", 400);
    }

    const apiActionConfig = apiActions[action.type];

    if (!apiActionConfig && action.type != Api.ActionType.BULK_GRAPH_ACTION) {
      throw new Api.ApiError("No handler matched the API action type", 404);
    }

    const now = Date.now();
    let auth: Auth.AuthContext | undefined;

    if (
      action.type == Api.ActionType.BULK_GRAPH_ACTION ||
      apiActionConfig.authenticated
    ) {
      if (!("auth" in action.meta) || !action.meta.auth) {
        throw new Api.ApiError(`Authentication failed (${transactionId})`, 401);
      }

      auth = await authenticate(action.meta.auth).catch((err) => {
        throw err;
      });
    }

    if (auth) {
      log("Authenticated action", {
        type: action.type,
        transactionId,
        bytes,
        org: [auth.org.name, auth.org.id].join(" → "),
        user:
          "user" in auth && auth.user
            ? "firstName" in auth.user
              ? [
                  [auth.user.firstName, auth.user.lastName].join(" "),
                  auth.user.id,
                ].join(" → ")
              : [auth.user.name, auth.user.id].join(" → ")
            : undefined,
        device:
          "orgUserDevice" in auth
            ? [auth.orgUserDevice.name, auth.orgUserDevice.id].join(" → ")
            : undefined,
        provisioningProvider:
          "provisioningProvider" in auth
            ? [
                auth.provisioningProvider.nickname,
                auth.provisioningProvider.id,
              ].join(" → ")
            : undefined,
        orgRole: "orgRole" in auth ? auth.orgRole?.name : undefined,
        // orgPermissions: Array.from(auth.orgPermissions),
      });
    }

    let transactionConn: PoolConnection | undefined;

    if (action.meta.loggableType != "fetchEnvkeyAction") {
      transactionConn = await pool.getConnection();
      await transactionConn.query(`SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
      START TRANSACTION;`);
    }

    logWithElapsed("started transaction", now);

    try {
      const result = await tryHandleAction({
        action,
        requestParams,
        apiActionConfig,
        now,
        transactionId,
        auth,
        transactionConn,
      });

      return result;
    } catch (err) {
      let msg: string, status: number;

      if (err instanceof Api.ApiError) {
        msg = err.message;
        status = err.code;
      } else if (err instanceof Error) {
        msg = err.message;
        status = 500;
      } else {
        msg = "Server error";
        status = 500;
      }

      log("handle action api error!", { action: action.type, transactionId });

      throw await apiErr(transactionConn, msg, status, err.stack);
    }
  },
  tryHandleAction = async (params: {
    action: Api.Action.RequestAction | Api.Action.BulkGraphAction;
    requestParams: Api.RequestParams;
    apiActionConfig: ApiActionConfig;
    now: number;
    transactionId: string;
    auth?: Auth.AuthContext;
    transactionConn?: PoolConnection;
  }): Promise<Api.Net.ApiResult> => {
    const {
      action,
      requestParams,
      apiActionConfig,
      now,
      transactionId,
      auth,
      transactionConn,
    } = params;

    let response: Api.Net.ApiResult | undefined,
      responseBytes: number | undefined,
      transactionStatements: Api.Db.SqlStatement[] = [],
      postUpdateActions: Api.HandlerPostUpdateActions | undefined,
      orgGraph: Api.Graph.OrgGraph | undefined,
      updatedOrgGraph: Api.Graph.OrgGraph | undefined,
      reorderBlobsIfNeeded = false;

    if (action.type == Api.ActionType.BULK_GRAPH_ACTION && auth) {
      orgGraph = await getOrgGraph(auth.org.id, {
        transactionConn,
        lockType: "FOR UPDATE",
      });

      logWithElapsed("got org graph", now);

      const actionResults: Awaited<ReturnType<typeof getActionRes>>[] = [];

      // const actionResults = await Promise.all(
      //   action.payload.map(async (graphAction) => {
      for (let graphAction of action.payload) {
        const graphApiActionConfig = apiActions[graphAction.type];
        if (!graphApiActionConfig) {
          throw new Api.ApiError("no handler supplied", 500);
        }
        if (!graphApiActionConfig.graphAction) {
          throw new Api.ApiError(
            "Bulk graph action can only be composed of graph actions",
            500
          );
        }
        if (graphApiActionConfig.reorderBlobsIfNeeded) {
          reorderBlobsIfNeeded = true;
        }
        log("Processing bulk action sub-action: ", {
          transactionId,
          graphAction: graphAction.type,
        });
        const res = await getActionRes(
          graphApiActionConfig,
          {
            ...graphAction,
            meta: {
              ...graphAction.meta,
              client: action.meta.client,
              auth: action.meta.auth,
            },
          } as Api.Action.GraphAction,
          requestParams,
          transactionConn,
          now,
          transactionId,
          auth,
          orgGraph,
          true
        );
        actionResults.push(res);
        // return res;
      }
      // ));

      for (let res of actionResults) {
        if (
          res.response.type != "graphDiffs" ||
          (response && response.type != "graphDiffs") ||
          !res.updatedOrgGraph ||
          !res.updatedUserGraph
        ) {
          throw await apiErr(
            transactionConn,
            "Bulk graph action can only be composed of graph actions with 'graphDiffs' responses",
            400
          );
        }

        const diffs = res.response.diffs;

        ({ updatedOrgGraph } = res);

        response = response
          ? (response = {
              ...response,
              diffs: [...response.diffs, ...diffs],
            })
          : res.response;

        if (res.transactionItems) {
          transactionStatements.push(
            ...objectTransactionStatements(res.transactionItems, now)
          );
        }

        transactionStatements.push(res.logTransactionStatement);

        postUpdateActions = postUpdateActions
          ? postUpdateActions.concat(res.postUpdateActions ?? [])
          : res.postUpdateActions;
      }
    } else {
      if (apiActionConfig.graphAction) {
        orgGraph = await getOrgGraph(auth!.org.id, {
          transactionConn,
          lockType:
            action.meta.loggableType == "orgAction" ? "FOR UPDATE" : undefined,
        });

        logWithElapsed("got org graph", now);

        if (apiActionConfig.reorderBlobsIfNeeded) {
          reorderBlobsIfNeeded = true;
        }
      }

      const res = await getActionRes(
        apiActionConfig,
        action,
        requestParams,
        transactionConn,
        now,
        transactionId,
        auth,
        orgGraph
      );

      response = res.response;
      responseBytes = res.responseBytes;
      postUpdateActions = res.postUpdateActions;
      updatedOrgGraph = res.updatedOrgGraph;

      if (res.transactionItems) {
        transactionStatements.push(
          ...objectTransactionStatements(res.transactionItems, now)
        );
      }

      transactionStatements.push(res.logTransactionStatement);
    }

    if (!responseBytes) {
      responseBytes = Buffer.byteLength(JSON.stringify(response), "utf8");
    }

    if (!response) {
      throw await apiErr(transactionConn, "Response undefined");
    }

    if (reorderBlobsIfNeeded && auth && orgGraph && updatedOrgGraph) {
      const reorderTransactionItems = getReorderEncryptedKeysTransactionItems(
        orgGraph,
        updatedOrgGraph
      );

      if (!objectTransactionItemsEmpty(reorderTransactionItems)) {
        transactionStatements.push(
          ...objectTransactionStatements(reorderTransactionItems, now)
        );
      }
    }

    try {
      await executeTransactionStatements(
        transactionStatements,
        transactionConn
      );
    } catch (err) {
      log("transaction error:", err);
      throw await apiErr(transactionConn, "Transaction failed", 500, err.stack);
    }

    logWithElapsed("executed transaction", now);

    if (transactionConn) {
      await transactionConn.release();
      logWithElapsed("released transaction", now);
    }

    // async s3 replication
    if (auth && updatedOrgGraph) {
      // don't await result, log/alert on error
      replicateIfNeeded(auth.org, updatedOrgGraph, now).catch((err) => {
        logStderr("Replication error", { err, orgId: auth.org.id });
      });
    }

    if (postUpdateActions) {
      await Promise.all(postUpdateActions.map((fn) => fn()));
    }

    resolveSocketUpdates(apiActionConfig, action, auth, updatedOrgGraph);

    logWithElapsed("resolved socket updates", now);

    logWithElapsed("response:", now, {
      error: "error" in response && response.error,
      errorReason: "errorReason" in response ? response.errorReason : undefined,
      status: "errorStatus" in response ? response.errorStatus : 200,
      actionType: action.type,
      responseBytes,
      timestamp: now,
    });

    return response;
  },
  getApiActionForType = (type: Api.ActionType) => {
    return apiActions[type];
  },
  apiErr = async (
    transactionConn: PoolConnection | undefined,
    msg: string,
    status: number = 500,
    stack?: Error["stack"]
  ) => {
    log(`api error: ${msg}`, {
      status,
      stack,
      transactionConn: Boolean(transactionConn),
    });
    if (transactionConn) {
      try {
        await transactionConn.query("ROLLBACK;");
      } catch (err) {
        logStderr("Error rolling back transaction:", {
          err,
          originalApiErrorStack: stack,
        });
      }

      try {
        await transactionConn.release();
      } catch (err) {
        logStderr("Error releasing transaction:", {
          err,
          originalApiErrorStack: stack,
        });
      }
    }
    return new Api.ApiError(msg, status);
  };

let socketServer: Api.SocketServer | undefined;

const apiActions: {
    [type: string]: ApiActionConfig;
  } = {},
  getActionRes = async (
    apiActionConfig: ApiActionConfig,
    action: Api.Action.RequestAction,
    requestParams: Api.RequestParams,
    transactionConn: PoolConnection | undefined,
    now: number,
    transactionId: string,
    auth?: Auth.AuthContext,
    orgGraph?: Api.Graph.OrgGraph,
    isBulkAction?: true
  ) => {
    if (!socketServer) {
      throw await apiErr(transactionConn, "Socket server not registered");
    }

    // validate payload with zod schema
    let payloadSchema = Api.Net.getSchema(action.type);
    if (!payloadSchema) {
      throw await apiErr(transactionConn, "No schema defined for action");
    }

    try {
      // keys / blobs can be large and slow to validate, and they are fully authorized elsewhere -- we will ignore errors for these props
      payloadSchema.parse(R.omit(["keys", "blobs"], action.payload));
    } catch (err) {
      let ignoredPropsOnly = true;
      if ("errors" in err && err.errors?.length) {
        for (let { path } of err.errors) {
          if (!R.equals(path, ["keys"]) && !R.equals(path, ["blobs"])) {
            ignoredPropsOnly = false;
          }
        }
      }
      if (!ignoredPropsOnly) {
        log("Payload failed validation", {
          payloadSchema,
          payload: action.payload,
          err,
        });
        let message = "Invalid payload";
        if ("errors" in err && err.errors?.length) {
          try {
            message +=
              ": " +
              err.errors
                .map(
                  (e: any) =>
                    e.unionErrors.map((u: any) => u.message ?? u) ??
                    e.message ??
                    e
                )
                ?.filter(Boolean)
                ?.join(". ");
          } catch (parseErr) {
            log("Failed simplifying validation errors", {
              payloadSchema,
              payload: action.payload,
              err,
            });
          }
        } else {
          message += ": " + err.message;
        }
        throw await apiErr(transactionConn, message, 422, err.stack);
      }
    }

    logWithElapsed("validated schema", now);

    const { ip } = requestParams;

    let updatedOrgGraph: Api.Graph.OrgGraph,
      userGraph: Client.Graph.UserGraph = {} as Client.Graph.UserGraph,
      updatedUserGraph: Client.Graph.UserGraph = {} as Client.Graph.UserGraph,
      updatedCurrentEncryptedKeys: Blob.KeySet | undefined;

    if (orgGraph) {
      const orgGraphBytes = Buffer.byteLength(JSON.stringify(orgGraph), "utf8");
      log("", { orgGraphBytes });
    }

    if (!auth) {
      if (apiActionConfig.authenticated) {
        throw await apiErr(transactionConn, "Auth required");
      }

      const {
        response,
        transactionItems,
        postUpdateActions,
        handlerContext,
        logTargetIds,
      } = await apiActionConfig.handler(
        action,
        now,
        requestParams,
        transactionConn
      );

      const targetIds = Array.isArray(logTargetIds)
        ? logTargetIds
        : logTargetIds(response);

      const responseBytes = Buffer.byteLength(JSON.stringify(response), "utf8");

      let logTransactionStatement: Api.Db.SqlStatement;
      try {
        logTransactionStatement = getLogTransactionStatement({
          action,
          auth,
          response,
          ip,
          transactionId,
          responseBytes,
          handlerContext,
          targetIds,
          now,
        });
      } catch (err) {
        const { message, code } = err as Api.ApiError;
        throw await apiErr(transactionConn, message, code, err.stack);
      }

      return {
        response,
        responseBytes,
        logTransactionStatement,
        transactionItems,
        postUpdateActions,
      };
    }

    if (!apiActionConfig.authenticated) {
      throw await apiErr(transactionConn, "Auth required");
    }

    let authorized: boolean;

    let userGraphDeviceId: string | undefined;
    switch (auth.type) {
      case "tokenAuthContext":
        userGraphDeviceId = auth.orgUserDevice.id;
        break;
      case "inviteAuthContext":
        userGraphDeviceId = auth.invite.id;
        break;
      case "deviceGrantAuthContext":
        userGraphDeviceId = auth.deviceGrant.id;
        break;
      case "recoveryKeyAuthContext":
        userGraphDeviceId = auth.recoveryKey.id;
        break;
    }

    if (apiActionConfig.graphAction) {
      if (!transactionConn) {
        throw new Api.ApiError(
          "Transaction connection required for graph actions",
          500
        );
      }

      if (!orgGraph) {
        throw await apiErr(
          transactionConn,
          "org graph required for graph action",
          500
        );
      }

      // force latest graph for all graph actions (unless they explicitly opt-out)
      if (
        !apiActionConfig.skipGraphUpdatedAtCheck &&
        (action.meta as { graphUpdatedAt: number }).graphUpdatedAt !==
          auth.org.graphUpdatedAt
      ) {
        throw await apiErr(transactionConn, "client graph outdated", 400);
      }

      if ("user" in auth) {
        userGraph = getApiUserGraph(
          orgGraph,
          auth.org.id,
          auth.user.id,
          userGraphDeviceId,
          now
        );
        logWithElapsed("got user graph", now);
      }

      // if there are any pending root pubkey replacements queued in this user's graph, these must be processed before user can make graph updates (enforced client-side too)
      // * only applies to actions with token or cli auth, not actions with invite, device grant, or recovery key auth
      if (
        auth.type == "tokenAuthContext" ||
        auth.type == "cliUserAuthContext"
      ) {
        const { rootPubkeyReplacements } = graphTypes(userGraph);
        if (rootPubkeyReplacements.length > 0) {
          throw await apiErr(
            transactionConn,
            "root pubkey replacements are pending in client graph--these must be processed prior to graph updates",
            400
          );
        }
      }

      if (apiActionConfig.graphAuthorizer) {
        authorized = await apiActionConfig.graphAuthorizer(
          action,
          orgGraph,
          userGraph,
          auth,
          now,
          requestParams,
          transactionConn
        );
        if (!authorized) {
          log("graphAuthorizer - false", {
            action: action.type,
            transactionId,
          });
        }
      } else {
        authorized = true;
      }

      logWithElapsed("ran graph authorizer", now);
    } else {
      if (apiActionConfig.authenticated && apiActionConfig.authorizer) {
        authorized = await apiActionConfig.authorizer(
          action,
          auth,
          transactionConn
        );
        if (!authorized) {
          log("handler unauthorized", { action: action.type, transactionId });
        }
      } else {
        authorized = true;
      }
    }

    if (!authorized) {
      throw await apiErr(transactionConn, "Unauthorized", 403);
    }

    if (!apiActionConfig.graphAction) {
      const {
          response,
          transactionItems,
          handlerContext,
          postUpdateActions,
          logTargetIds,
        } = await apiActionConfig.handler(
          action,
          auth,
          now,
          requestParams,
          transactionConn
        ),
        responseBytes = Buffer.byteLength(JSON.stringify(response), "utf8");

      const targetIds = Array.isArray(logTargetIds)
        ? logTargetIds
        : logTargetIds(response);

      let logTransactionStatement: Api.Db.SqlStatement;
      try {
        logTransactionStatement = getLogTransactionStatement({
          action,
          auth,
          updatedUserGraph: (
            response as {
              graph?: Client.Graph.UserGraph;
            }
          ).graph,
          response,
          transactionId,
          ip,
          targetIds,
          responseBytes,
          handlerContext,
          now,
        });
      } catch (err) {
        const { message, code } = err as Api.ApiError;
        throw await apiErr(transactionConn, message, code, err.stack);
      }

      return {
        response,
        responseBytes,
        logTransactionStatement,
        transactionItems,
        postUpdateActions,
      };
    }

    if (!(orgGraph && userGraph)) {
      throw await apiErr(transactionConn, "orgGraph and userGraph not loaded");
    }

    let handlerContext: Api.HandlerContext | undefined,
      handlerTransactionItems: Api.Db.ObjectTransactionItems | undefined,
      handlerPostUpdateActions: Api.HandlerPostUpdateActions | undefined,
      handlerEnvs: Api.HandlerEnvsResponse | undefined,
      handlerChangesets: Api.HandlerChangesetsResponse | undefined,
      handlerSignedTrustedRootPubkey: Crypto.SignedData | undefined,
      handlerOrgAccessChangeScope: Rbac.OrgAccessScope | undefined,
      handlerEncryptedKeysScope: Rbac.OrgAccessScope | undefined,
      handlerLogTargetIds: Api.GraphHandlerResult["logTargetIds"] | undefined;

    if (apiActionConfig.graphHandler) {
      if (!transactionConn) {
        throw new Api.ApiError(
          "Transaction connection required for graph actions",
          500
        );
      }
      const handlerRes = await apiActionConfig.graphHandler(
        action,
        orgGraph,
        auth,
        now,
        requestParams,
        transactionConn,
        socketServer
      );

      logWithElapsed("ran graph handler", now);

      if (handlerRes.type == "response") {
        const responseBytes = Buffer.byteLength(
          JSON.stringify(handlerRes.response),
          "utf8"
        );

        const targetIds = Array.isArray(handlerRes.logTargetIds)
          ? handlerRes.logTargetIds
          : handlerRes.logTargetIds(handlerRes.response);

        let logTransactionStatement: Api.Db.SqlStatement;
        try {
          logTransactionStatement = getLogTransactionStatement({
            action,
            auth,
            previousOrgGraph: orgGraph,
            updatedOrgGraph: orgGraph,
            updatedUserGraph: userGraph!,
            response: handlerRes.response,
            handlerContext: handlerRes.handlerContext,
            ip,
            transactionId,
            targetIds,
            responseBytes,
            now,
          });
        } catch (err) {
          const { message, code } = err as Api.ApiError;
          throw await apiErr(transactionConn, message, code, err.stack);
        }

        return {
          response: handlerRes.response,
          responseBytes,
          logTransactionStatement,
          transactionItems: handlerRes.transactionItems,
          postUpdateActions: handlerRes.postUpdateActions,
        };
      }

      handlerContext = handlerRes.handlerContext;
      handlerTransactionItems = handlerRes.transactionItems;
      handlerPostUpdateActions = handlerRes.postUpdateActions;
      handlerEnvs = handlerRes.envs;
      handlerChangesets = handlerRes.changesets;
      handlerSignedTrustedRootPubkey = handlerRes.signedTrustedRoot;
      handlerOrgAccessChangeScope = handlerRes.orgAccessChangeScope;
      handlerEncryptedKeysScope = handlerRes.encryptedKeysScope;
      handlerLogTargetIds = handlerRes.logTargetIds;

      updatedOrgGraph = handlerRes.graph;
    } else {
      updatedOrgGraph = orgGraph;
    }

    let allTransactionItems: Api.Db.ObjectTransactionItems =
      handlerTransactionItems ?? {};

    updatedOrgGraph = deleteExpiredAuthObjects(updatedOrgGraph, now);

    logWithElapsed("deleteExpiredAuthObjects", now);

    updatedOrgGraph = clearOrphanedRootPubkeyReplacements(updatedOrgGraph, now);

    logWithElapsed("clearOrphanedRootPubkeyReplacements", now);

    if (action.meta.loggableType == "orgAction") {
      const clearOrphanedLocalsRes = clearOrphanedLocals(updatedOrgGraph);
      updatedOrgGraph = clearOrphanedLocalsRes[0];

      allTransactionItems = mergeObjectTransactionItems([
        allTransactionItems,
        clearOrphanedLocalsRes[1],
      ]);

      logWithElapsed("clearOrphanedLocals", now);
    }

    logWithElapsed("cleaned up org graph", now);

    if ("user" in auth) {
      updatedUserGraph = getApiUserGraph(
        updatedOrgGraph,
        auth.org.id,
        auth.user.id,
        userGraphDeviceId,
        now
      );
    }

    logWithElapsed("got updated user graph", now);

    if (
      auth.type != "provisioningBearerAuthContext" &&
      apiActionConfig.graphAuthorizer &&
      (("keys" in action.payload && action.payload.keys) ||
        ("blobs" in action.payload && action.payload.blobs))
    ) {
      authorized = await authorizeEnvsUpdate(
        updatedUserGraph,
        auth,
        action as Api.Action.GraphAction
      );
      if (!authorized) {
        log("env update unauthorized");
        throw await apiErr(transactionConn, "Unauthorized", 403);
      }
    }

    if (handlerTransactionItems) {
      allTransactionItems = mergeObjectTransactionItems([
        allTransactionItems,
        handlerTransactionItems,
      ]);
    }

    let graphTransactionItems = getGraphTransactionItems(
      orgGraph,
      updatedOrgGraph,
      now
    );

    logWithElapsed("got graph transaction items", now);

    const hasGraphTransactionItems = !objectTransactionItemsEmpty(
      graphTransactionItems
    );

    logWithElapsed("checked transactions empty", now);

    if (hasGraphTransactionItems) {
      if (
        action.type != Api.ActionType.UPDATE_ENVS &&
        action.type != Api.ActionType.REENCRYPT_ENVS &&
        handlerEncryptedKeysScope
      ) {
        const beforeUpdateCurrentEncryptedKeys = getCurrentEncryptedKeys(
          orgGraph,
          handlerEncryptedKeysScope,
          now
        );

        logWithElapsed("beforeUpdateCurrentEncryptedKeys", now);

        updatedCurrentEncryptedKeys = getCurrentEncryptedKeys(
          updatedOrgGraph,
          handlerEncryptedKeysScope,
          now
        );

        logWithElapsed("updatedCurrentEncryptedKeys", now);

        const toDeleteEncryptedKeys = keySetDifference(
          beforeUpdateCurrentEncryptedKeys,
          updatedCurrentEncryptedKeys
        );

        logWithElapsed("toDeleteEncryptedKeys", now);

        if (!keySetEmpty(toDeleteEncryptedKeys)) {
          const queueBlobsForReencryptionRes =
            queueBlobsForReencryptionIfNeeded(
              auth,
              toDeleteEncryptedKeys,
              updatedOrgGraph,
              now
            );

          if (queueBlobsForReencryptionRes) {
            updatedOrgGraph = queueBlobsForReencryptionRes;
            graphTransactionItems = getGraphTransactionItems(
              orgGraph,
              updatedOrgGraph,
              now
            );
          }

          const deleteEncryptedKeysTransactionItems =
            await getDeleteEncryptedKeysTransactionItems(
              auth,
              orgGraph,
              toDeleteEncryptedKeys
            );

          allTransactionItems = mergeObjectTransactionItems([
            allTransactionItems,
            deleteEncryptedKeysTransactionItems,
          ]);
        }

        const toRequireEncryptedKeys = keySetDifference(
          updatedCurrentEncryptedKeys,
          beforeUpdateCurrentEncryptedKeys
        );

        logWithElapsed("toRequireEncryptedKeys", now);

        if (!keySetEmpty(toRequireEncryptedKeys)) {
          try {
            requireEncryptedKeys(
              (action.payload as Api.Net.EnvParams).keys ?? {},
              toRequireEncryptedKeys,
              handlerContext,
              orgGraph
            );
          } catch (err) {
            const { message, code } = err as Api.ApiError;
            throw await apiErr(transactionConn, message, code, err.stack);
          }
        }
      }

      allTransactionItems = mergeObjectTransactionItems([
        allTransactionItems,
        graphTransactionItems,
      ]);

      logWithElapsed("merged transaction items", now);

      const updatedOrg = {
        ...updatedOrgGraph[auth.org.id],
        graphUpdatedAt: now,
        rbacUpdatedAt: apiActionConfig.rbacUpdate
          ? now
          : auth.org.rbacUpdatedAt,
        updatedAt: now,
      } as Api.Db.Org;

      updatedOrgGraph = { ...updatedOrgGraph, [auth.org.id]: updatedOrg };

      logWithElapsed("set updated org graph", now);

      allTransactionItems = mergeObjectTransactionItems([
        allTransactionItems,
        {
          updates: [[pick(["pkey", "skey"], updatedOrg), updatedOrg]],
        },
      ]);

      if ("user" in auth) {
        updatedUserGraph = getApiUserGraph(
          updatedOrgGraph,
          auth.org.id,
          auth.user.id,
          userGraphDeviceId,
          now
        );
      }

      logWithElapsed("got updated user graph", now);

      if (
        auth.type != "provisioningBearerAuthContext" &&
        (("keys" in action.payload && action.payload.keys) ||
          ("blobs" in action.payload && action.payload.blobs))
      ) {
        const envParamsTransactionItems = getEnvParamsTransactionItems(
          auth,
          orgGraph,
          updatedOrgGraph,
          action,
          now,
          handlerContext
        );

        allTransactionItems = mergeObjectTransactionItems([
          allTransactionItems,
          envParamsTransactionItems,
        ]);
      }
    }

    let responseType: Api.GraphResponseType =
        apiActionConfig.graphResponse ?? "diffs",
      deviceId: string;

    if (auth.type == "inviteAuthContext") {
      deviceId = auth.invite.id;
    } else if (auth.type == "deviceGrantAuthContext") {
      deviceId = auth.deviceGrant.id;
    } else if (auth.type == "recoveryKeyAuthContext") {
      deviceId = auth.recoveryKey.id;
    } else if (auth.type == "cliUserAuthContext") {
      deviceId = "cli";
    } else if (auth.type == "tokenAuthContext") {
      deviceId = auth.orgUserDevice.id;
    }

    let response: Api.Net.ApiResult | undefined;
    const graphUpdatedAt = hasGraphTransactionItems
      ? now
      : auth.org.graphUpdatedAt;

    switch (responseType) {
      case "diffs":
        response = {
          type: "graphDiffs",
          diffs: hasGraphTransactionItems
            ? createPatch(userGraph, updatedUserGraph)
            : [],
          graphUpdatedAt,
          timestamp: now,
        };

        break;

      case "graph":
        response = {
          type: "graph",
          graph: updatedUserGraph,
          graphUpdatedAt,
          signedTrustedRoot: handlerSignedTrustedRootPubkey,
          timestamp: now,
        };
        break;

      case "ok":
        response = {
          type: "success",
        };
        break;

      case "scimUserCandidate":
        const { status, scimUserResponse } = handlerContext as Extract<
          Api.HandlerContext,
          { type: Api.ActionType.GET_SCIM_USER }
        >;
        response = {
          status,
          ...scimUserResponse,
        };
        break;

      case "graphWithEnvs":
      case "loadedInvite":
      case "loadedDeviceGrant":
      case "loadedRecoveryKey":
        let envEncryptedKeys: Blob.UserEncryptedKeysByEnvironmentIdOrComposite =
            {},
          envBlobs: Blob.UserEncryptedBlobsByEnvironmentIdOrComposite = {},
          changesetEncryptedKeys: Blob.UserEncryptedChangesetKeysByEnvironmentId =
            {},
          changesetBlobs: Blob.UserEncryptedBlobsByEnvironmentIdOrComposite =
            {};

        if (auth.type != "provisioningBearerAuthContext") {
          if (handlerEnvs) {
            if (handlerEnvs.all) {
              [envEncryptedKeys, envBlobs] = await Promise.all([
                getEnvEncryptedKeys({
                  orgId: auth.org.id,
                  userId: auth.user.id,
                  deviceId: deviceId!,
                  blobType: "env",
                }),
                getEnvEncryptedBlobs({
                  orgId: auth.org.id,
                  blobType: "env",
                }),
              ]);
            } else if (handlerEnvs.scopes) {
              [envEncryptedKeys, envBlobs] = await Promise.all([
                Promise.all(
                  handlerEnvs.scopes.map((scope) =>
                    getEnvEncryptedKeys({
                      orgId: auth.org.id,
                      userId: auth.user.id,
                      deviceId: deviceId!,
                      ...scope,
                    })
                  )
                ).then((encryptedKeys) =>
                  encryptedKeys.reduce(R.mergeDeepRight, {})
                ),
                Promise.all(
                  handlerEnvs.scopes.map((scope) =>
                    getEnvEncryptedBlobs({
                      orgId: auth.org.id,
                      ...scope,
                    })
                  )
                ).then((blobs) => blobs.reduce(R.mergeDeepRight, {})),
              ]);
            }

            envBlobs = pick(Object.keys(envEncryptedKeys), envBlobs);
          }

          if (handlerChangesets) {
            if (handlerChangesets.all) {
              [changesetEncryptedKeys, changesetBlobs] = await Promise.all([
                await getChangesetEncryptedKeys({
                  orgId: auth.org.id,
                  userId: auth.user.id,
                  deviceId: deviceId!,
                  createdAfter: handlerChangesets.createdAfter,
                }),
                await getChangesetEncryptedBlobs({
                  orgId: auth.org.id,
                  createdAfter: handlerChangesets.createdAfter,
                }),
              ]);
            } else if (handlerChangesets.scopes) {
              [changesetEncryptedKeys, changesetBlobs] = await Promise.all([
                await Promise.all(
                  handlerChangesets.scopes.map((scope) =>
                    getChangesetEncryptedKeys({
                      orgId: auth.org.id,
                      userId: auth.user.id,
                      deviceId: deviceId!,
                      ...scope,
                      createdAfter: handlerChangesets!.createdAfter,
                    })
                  )
                ).then((encryptedKeys) => {
                  return encryptedKeys.reduce(R.mergeDeepRight, {});
                }),
                await Promise.all(
                  handlerChangesets.scopes.map((scope) =>
                    getChangesetEncryptedBlobs({
                      orgId: auth.org.id,
                      ...scope,
                      createdAfter: handlerChangesets!.createdAfter,
                    })
                  )
                ).then((blobs) => {
                  return blobs.reduce(R.mergeDeepRight, {});
                }),
              ]);
            }

            changesetBlobs = pick(
              Object.values(changesetEncryptedKeys)
                .flat()
                .map(({ environmentId, changesetId }) =>
                  [environmentId, changesetId].join("|")
                ),
              changesetBlobs
            );
          }
        }

        const baseResponse = {
          graph: updatedUserGraph,
          graphUpdatedAt,
          envs: { keys: envEncryptedKeys, blobs: envBlobs },
          changesets: { keys: changesetEncryptedKeys, blobs: changesetBlobs },
          signedTrustedRoot: handlerSignedTrustedRootPubkey,
          timestamp: now,
        };

        if (responseType == "graphWithEnvs") {
          response = {
            ...baseResponse,
            recentChangesets:
              action.type == Api.ActionType.FETCH_ENVS &&
              action.payload.changesetOptions?.createdAfter
                ? true
                : undefined,
            type: "graphWithEnvs",
          };
        } else if (responseType == "loadedInvite") {
          if (auth.type != "inviteAuthContext") {
            throw await apiErr(
              transactionConn,
              "Missing invite authentication"
            );
          }

          response = {
            ...baseResponse,
            type: "loadedInvite",
            orgId: auth.org.id,
            invite: pick(
              [
                "id",
                "encryptedPrivkey",
                "pubkey",
                "invitedByDeviceId",
                "invitedByUserId",
                "inviteeId",
                "deviceId",
              ],
              auth.invite
            ),
          };
        } else if (responseType == "loadedDeviceGrant") {
          if (auth.type != "deviceGrantAuthContext") {
            throw await apiErr(
              transactionConn,
              "Missing device grant authentication"
            );
          }

          response = {
            ...baseResponse,
            type: "loadedDeviceGrant",
            orgId: auth.org.id,
            deviceGrant: pick(
              [
                "id",
                "encryptedPrivkey",
                "pubkey",
                "grantedByDeviceId",
                "grantedByUserId",
                "granteeId",
                "deviceId",
              ],
              auth.deviceGrant
            ),
          };
        } else if (
          responseType == "loadedRecoveryKey" &&
          handlerContext &&
          handlerContext.type == Api.ActionType.LOAD_RECOVERY_KEY
        ) {
          response = {
            ...baseResponse,
            type: "loadedRecoveryKey",
            orgId: auth.org.id,
            recoveryKey: pick(
              [
                "pubkey",
                "encryptedPrivkey",
                "userId",
                "deviceId",
                "creatorDeviceId",
              ],
              handlerContext.recoveryKey
            ),
          };
        }

        break;

      case "session":
        switch (auth.type) {
          case "tokenAuthContext":
            response = {
              type: "tokenSession",
              token: auth.authToken.token,
              provider: auth.authToken.provider,
              ...pick(["uid", "email", "firstName", "lastName"], auth.user),
              userId: auth.user.id,
              orgId: auth.org.id,
              deviceId: auth.orgUserDevice.id,
              graph: updatedUserGraph,
              graphUpdatedAt,
              signedTrustedRoot: auth.orgUserDevice.signedTrustedRoot,
              timestamp: now,
              ...(env.IS_CLOUD_ENVKEY
                ? {
                    hostType: <const>"cloud",
                  }
                : {
                    hostType: <const>"self-hosted",
                    deploymentTag: env.DEPLOYMENT_TAG,
                  }),
            };
            break;

          case "inviteAuthContext":
          case "deviceGrantAuthContext":
          case "recoveryKeyAuthContext":
            if (
              handlerContext &&
              (handlerContext.type == Api.ActionType.ACCEPT_INVITE ||
                handlerContext.type == Api.ActionType.ACCEPT_DEVICE_GRANT ||
                handlerContext.type == Api.ActionType.REDEEM_RECOVERY_KEY)
            ) {
              response = {
                type: "tokenSession",
                token: handlerContext.authToken.token,
                provider: handlerContext.authToken.provider,
                ...pick(["uid", "email", "firstName", "lastName"], auth.user),
                userId: auth.user.id,
                orgId: auth.org.id,
                deviceId: handlerContext.orgUserDevice.id,
                graph: updatedUserGraph,
                graphUpdatedAt,
                envs: {
                  keys: {},
                  blobs: {},
                },
                timestamp: now,
                ...(env.IS_CLOUD_ENVKEY
                  ? {
                      hostType: <const>"cloud",
                    }
                  : {
                      hostType: <const>"self-hosted",
                      deploymentTag: env.DEPLOYMENT_TAG,
                    }),
              };
            }
            break;
        }
    }
    if (!response) {
      throw await apiErr(transactionConn, "response is undefined", 500);
    }

    logWithElapsed("got response", now);

    const accessUpdated = handlerOrgAccessChangeScope
      ? getAccessUpdated(orgGraph, updatedOrgGraph, handlerOrgAccessChangeScope)
      : undefined;

    logWithElapsed("got access updated", now);

    const responseBytes = Buffer.byteLength(JSON.stringify(response), "utf8");

    const targetIds = Array.isArray(handlerLogTargetIds)
      ? handlerLogTargetIds
      : handlerLogTargetIds!(response);

    let logTransactionStatement: Api.Db.SqlStatement;
    try {
      logTransactionStatement = getLogTransactionStatement({
        action,
        auth,
        previousOrgGraph: orgGraph,
        updatedOrgGraph,
        updatedUserGraph,
        accessUpdated,
        response: response,
        handlerContext,
        transactionId,
        targetIds,
        ip,
        responseBytes,
        now,
      });
    } catch (err) {
      const { message, code } = err as Api.ApiError;
      throw await apiErr(transactionConn, message, code, err.stack);
    }

    logWithElapsed("got log transaction items", now);

    return {
      response,
      responseBytes,
      logTransactionStatement,
      transactionItems: allTransactionItems,
      postUpdateActions: handlerPostUpdateActions,
      updatedOrgGraph,
      updatedUserGraph,
      updatedCurrentBlobs: updatedCurrentEncryptedKeys,
    };
  },
  resolveSocketUpdates = (
    apiActionConfig: ApiActionConfig | undefined,
    action: Api.Action.RequestAction,
    auth: Auth.AuthContext | undefined,
    orgGraph: Api.Graph.OrgGraph | undefined
  ) => {
    if (!auth || !socketServer) {
      return;
    }

    let shouldSendSocketUpdate = false,
      actionTypes: Api.ActionType[],
      userIds: string[] | undefined,
      deviceIds: string[] | undefined;
    if (action.meta.loggableType == "orgAction") {
      shouldSendSocketUpdate = true;
      actionTypes = [action.type];
    } else if (action.type == Api.ActionType.BULK_GRAPH_ACTION) {
      shouldSendSocketUpdate = true;
      actionTypes = action.payload.map(R.prop("type"));
    } else if (
      apiActionConfig &&
      "broadcastOrgSocket" in apiActionConfig &&
      apiActionConfig.broadcastOrgSocket
    ) {
      if (apiActionConfig.broadcastOrgSocket === true) {
        shouldSendSocketUpdate = true;
        actionTypes = [action.type];
      } else {
        const broadcastRes = apiActionConfig.broadcastOrgSocket(action);
        if (typeof broadcastRes == "object") {
          actionTypes = [action.type];
          shouldSendSocketUpdate = true;

          if ("userIds" in broadcastRes) {
            userIds = broadcastRes.userIds;
          } else {
            deviceIds = broadcastRes.deviceIds;
          }
        } else if (broadcastRes === true) {
          actionTypes = [action.type];
          shouldSendSocketUpdate = true;
        }
      }
    }

    let toClearSockets: Api.ClearSocketParams[] = [];
    let broadcastAdditionalOrgSocketIds: string[] = [];
    if (action.type == Api.ActionType.BULK_GRAPH_ACTION) {
      for (let subAction of action.payload) {
        const subApiActionConfig = apiActions[subAction.type];
        if (subApiActionConfig.clearSockets) {
          toClearSockets = toClearSockets.concat(
            subApiActionConfig.clearSockets(
              auth,
              subAction as Api.Action.RequestAction,
              orgGraph
            )
          );
        }
        if (
          "broadcastAdditionalOrgSocketIds" in subApiActionConfig &&
          subApiActionConfig.broadcastAdditionalOrgSocketIds
        ) {
          broadcastAdditionalOrgSocketIds =
            broadcastAdditionalOrgSocketIds.concat(
              subApiActionConfig.broadcastAdditionalOrgSocketIds
            );
        }
      }
    } else {
      if (apiActionConfig && apiActionConfig.clearSockets) {
        toClearSockets = apiActionConfig.clearSockets(auth, action, orgGraph);
      }

      if (
        apiActionConfig &&
        "broadcastAdditionalOrgSocketIds" in apiActionConfig &&
        apiActionConfig.broadcastAdditionalOrgSocketIds
      ) {
        broadcastAdditionalOrgSocketIds =
          apiActionConfig.broadcastAdditionalOrgSocketIds;
      }
    }

    if (shouldSendSocketUpdate || toClearSockets.length > 0) {
      // defer these until after response
      setImmediate(() => {
        if (shouldSendSocketUpdate) {
          socketServer!.sendOrgUpdate(
            auth.org.id,
            {
              actionTypes,
              actorId:
                auth.type == "provisioningBearerAuthContext"
                  ? auth.provisioningProvider.id
                  : auth.user.id,
            },
            "orgUserDevice" in auth ? auth.orgUserDevice.id : undefined,
            { userIds, deviceIds }
          );

          if (broadcastAdditionalOrgSocketIds) {
            for (let orgId of broadcastAdditionalOrgSocketIds) {
              socketServer!.sendOrgUpdate(orgId, { actionTypes });
            }
          }
        }
        toClearSockets.forEach(clearSockets);
      });
    }
  },
  clearSockets = (params: Api.ClearSocketParams) => {
    if ("deviceId" in params) {
      socketServer!.clearDeviceSocket(
        params.orgId,
        params.userId,
        params.deviceId
      );
    } else if ("userId" in params) {
      socketServer!.clearUserSockets(params.orgId, params.userId);
    } else {
      socketServer!.clearOrgSockets(params.orgId);
    }
  };

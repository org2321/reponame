import { Db as _Db } from "./db";
import { Net as _Net } from "./net";
import { Action as _Action } from "./action";
import { default as _ActionType } from "./action_type";
import { Graph as _Graph } from "./graph";
import Client from "../client";
import { Auth } from "../auth";
import { Blob } from "../blob";
import { Crypto } from "../crypto";
import * as Rbac from "../rbac";
import mysql from "mysql2/promise";

namespace Api {
  export import Db = _Db;
  export import Net = _Net;
  export import Action = _Action;
  export import ActionType = _ActionType;
  export import Graph = _Graph;

  export type Env = {
    RUNTIME: "lambda" | "express";
    NODE_ENV: "production" | "development";
    SERVER_MODE: "api_only" | "fetch_only" | "combined";

    FAILOVER_SIGNING_PUBKEY: string;

    VERIFIED_SENDER_EMAIL: string;

    DISABLE_DB_MIGRATIONS?: string;

    DATABASE_HOST: string;
    DATABASE_PORT?: string;
    DATABASE_NAME: string;
    DATABASE_CREDENTIALS_JSON: string;

    SOCKET_CLUSTER_AUTH?: string;

    EMAILS_PER_SECOND?: string;

    API_VERSION_NUMBER: string;
    INFRA_VERSION_NUMBER: string;
    DEPLOYMENT_TAG: string;

    FAILOVER_BUCKET: string;
    LOGS_BUCKET: string;
    FAILOVER_LOGS_INTERVAL?: string;
    IS_CLOUD_ENVKEY?: string;

    EXPRESS_PORT?: string;

    EMAIL_TOKEN_EXPIRATION_MS?: string;
    EXTERNAL_AUTH_SESSION_EXPIRATION_MS?: string;

    OAUTH_GITHUB_CLIENT_ID?: string;
    OAUTH_GITHUB_CLIENT_SECRET?: string;

    OAUTH_GITLAB_CLIENT_ID?: string;
    OAUTH_GITLAB_CLIENT_SECRET?: string;

    OAUTH_GOOGLE_CLIENT_ID?: string;
    OAUTH_GOOGLE_CLIENT_SECRET?: string;

    // deployed app subdomain part like "am3bk2z0pd3"
    SUBDOMAIN?: string;
    // deployed app domain part like "quite-secure.com"
    DOMAIN?: string;
  };

  export class ApiError extends Error {
    code: number;
    constructor(message: string, code: number) {
      super(message);
      this.code = code;
      return this;
    }
  }

  export type HandlerContext =
    | {
        type: ActionType.CREATE_INVITE;
        inviteId: string;
        inviteeId: string;
      }
    | {
        type: ActionType.CREATE_DEVICE_GRANT;
        granteeId: string;
        createdId: string;
      }
    | {
        type:
          | ActionType.CREATE_CLI_USER
          | ActionType.CREATE_APP
          | ActionType.CREATE_BLOCK
          | ActionType.CREATE_VARIABLE_GROUP
          | ActionType.CREATE_SERVER
          | ActionType.CREATE_LOCAL_KEY
          | ActionType.RBAC_CREATE_ORG_ROLE
          | ActionType.CREATE_ENVIRONMENT
          | ActionType.RBAC_CREATE_ENVIRONMENT_ROLE
          | ActionType.RBAC_CREATE_APP_ROLE
          | ActionType.RBAC_CREATE_INCLUDED_APP_ROLE
          | ActionType.CREATE_GROUP
          | ActionType.CREATE_GROUP_MEMBERSHIP
          | ActionType.CREATE_APP_USER_GROUP
          | ActionType.CREATE_APP_GROUP_USER_GROUP
          | ActionType.CREATE_APP_GROUP_USER
          | ActionType.CREATE_APP_BLOCK_GROUP
          | ActionType.CREATE_APP_GROUP_BLOCK
          | ActionType.CREATE_APP_GROUP_BLOCK_GROUP
          | ActionType.GENERATE_KEY
          | ActionType.GRANT_APP_ACCESS
          | ActionType.CONNECT_BLOCK
          | ActionType.CREATE_RECOVERY_KEY
          | ActionType.CREATE_ORG_SAML_PROVIDER
          | ActionType.CREATE_SCIM_PROVISIONING_PROVIDER;
        createdId: string;
      }
    | {
        type: ActionType.ACCEPT_INVITE;
        authToken: Db.AuthToken;
        orgUserDevice: Db.OrgUserDevice;
        invite: Db.Invite;
      }
    | {
        type: ActionType.ACCEPT_DEVICE_GRANT;
        authToken: Db.AuthToken;
        orgUserDevice: Db.OrgUserDevice;
        deviceGrant: Db.DeviceGrant;
      }
    | {
        type: ActionType.LOAD_RECOVERY_KEY;
        recoveryKey: Db.RecoveryKey;
      }
    | {
        type: ActionType.REDEEM_RECOVERY_KEY;
        authToken: Db.AuthToken;
        orgUserDevice: Db.OrgUserDevice;
        recoveryKey: Db.RecoveryKey;
      }
    | {
        type: ActionType.FETCH_ENVKEY | ActionType.CHECK_ENVKEY;
        orgId: string;
        actorId: string;
        generatedEnvkey: Db.GeneratedEnvkey;
      }
    | {
        type: ActionType.CREATE_SCIM_USER | ActionType.UPDATE_SCIM_USER;
        scimUserCandidate: Db.ScimUserCandidate;
        scimUserResponse: Api.Net.ScimUserResponse;
      }
    | {
        type: ActionType.GET_EXTERNAL_AUTH_SESSION;
        externalAuthSession: Db.ExternalAuthSession;
      }
    | {
        type: ActionType.GET_SCIM_USER;
        status: number;
        scimUserResponse: Api.Net.ScimUserResponse;
        scimUserCandidate: Db.ScimUserCandidate;
      }
    | {
        type: ActionType.DELETE_SCIM_USER;
        orgUser?: Db.OrgUser;
        scimUserCandidate: Db.ScimUserCandidate;
      }
    | {
        type: ActionType.REVOKE_INVITE;
        invite: Db.Invite;
      }
    | {
        type: ActionType.REVOKE_DEVICE_GRANT;
        deviceGrant: Db.DeviceGrant;
      }
    | {
        type: ActionType.REVOKE_DEVICE;
        device: Db.OrgUserDevice;
      }
    | {
        type: ActionType.ENVKEY_FETCH_UPDATE_TRUSTED_ROOT_PUBKEY;
        actorId: string;
      }
    | {
        type: ActionType.AUTHENTICATE_CLI_KEY;
        cliUser: Api.Db.CliUser;
      };

  export type GraphResponseType =
    | "diffs"
    | "graph"
    | "graphWithEnvs"
    | "loadedInvite"
    | "loadedDeviceGrant"
    | "loadedRecoveryKey"
    | "session"
    | "ok"
    | "scimUserCandidate";

  export type HandlerPostUpdateActions = (() => Promise<any>)[];

  export type HandlerEnvsResponse =
    | {
        all: true;
        scopes?: undefined;
      }
    | {
        all?: undefined;
        scopes?: Blob.ScopeParams[];
      };

  export type HandlerChangesetsResponse = HandlerEnvsResponse &
    Net.FetchChangesetOptions;

  export type ClearSocketParams =
    | {
        orgId: string;
      }
    | {
        orgId: string;
        userId: string;
      }
    | {
        orgId: string;
        userId: string;
        deviceId: string;
      };

  type HandlerResultBase = {
    logTargetIds:
      | string[]
      | ((
          response: Api.Net.ApiResult,
          accessUpdated?: Rbac.OrgAccessUpdated
        ) => string[]);
    handlerContext?: HandlerContext;
    transactionItems?: Db.ObjectTransactionItems;
    postUpdateActions?: HandlerPostUpdateActions;
  };

  export type GraphHandlerResult<
    ResponseType extends Net.ApiResult = Net.ApiResult
  > = HandlerResultBase &
    (
      | {
          type: "graphHandlerResult";
          graph: Graph.OrgGraph;
          deleteBlobs?: Blob.KeySet;
          requireBlobs?: Blob.KeySet;
          envs?: HandlerEnvsResponse;
          changesets?: HandlerEnvsResponse;
          recentChangesets?: true;
          signedTrustedRoot?: Crypto.SignedData;
          orgAccessChangeScope?: Rbac.OrgAccessScope;
          encryptedKeysScope?: Rbac.OrgAccessScope;
        }
      | {
          type: "response";
          response: ResponseType;
        }
    );

  export type HandlerResult<
    ResponseType extends Net.ApiResult = Net.ApiResult
  > = HandlerResultBase & {
    type: "handlerResult";
    response: ResponseType;
  };

  export type RequestParams = {
    ip: string;
    host: string;
    method: "post" | "get" | "head" | "patch" | "delete";
  };

  export type ApiActionParams<
    T extends Action.RequestAction = Action.RequestAction,
    ResponseType extends Net.ApiResult = Net.ApiResult,
    AuthContextType extends Auth.AuthContext = Auth.AuthContext
  > = {
    type: T["type"];
    clearSockets?: (
      auth: AuthContextType,
      action: T,
      orgGraph: T extends Api.Action.GraphAction ? Graph.OrgGraph : undefined
    ) => ClearSocketParams[];
  } & (
    | {
        authenticated: true;
        graphAction: true;
        skipGraphUpdatedAtCheck?: true;
        graphResponse?: GraphResponseType; // default "diffs"
        rbacUpdate?: true;
        reorderBlobsIfNeeded?: true;
        broadcastAdditionalOrgSocketIds?: string[];
        graphAuthorizer?: (
          action: T,
          orgGraph: Graph.OrgGraph,
          userGraph: Client.Graph.UserGraph,
          auth: AuthContextType,
          now: number,
          requestParams: RequestParams,
          transactionConn: mysql.PoolConnection
        ) => Promise<boolean>;
        graphHandler?: (
          action: T,
          orgGraph: Graph.OrgGraph,
          auth: AuthContextType,
          now: number,
          requestParams: RequestParams,
          transactionConn: mysql.PoolConnection,
          socketServer: Api.SocketServer
        ) => Promise<GraphHandlerResult<ResponseType>>;
      }
    | {
        graphAction: false;
        authenticated: true;
        broadcastOrgSocket?:
          | true
          | ((action: T) =>
              | boolean
              | {
                  userIds: string[];
                }
              | {
                  deviceIds: string[];
                });
        authorizer?: (
          action: T,
          auth: AuthContextType,
          transactionConn?: mysql.PoolConnection
        ) => Promise<boolean>;
        handler: (
          action: T,
          auth: AuthContextType,
          now: number,
          requestParams: RequestParams,
          transactionConn?: mysql.PoolConnection
        ) => Promise<HandlerResult<ResponseType>>;
      }
    | {
        graphAction: false;
        authenticated: false;
        handler: (
          action: T,
          now: number,
          requestParams: RequestParams,
          transactionConn?: mysql.PoolConnection
        ) => Promise<HandlerResult<ResponseType>>;
      }
  );

  export type OrgSocketUpdateMessage = {
    actorId?: string;
  } & (
    | {
        otherUpdateReason?: undefined;
        actionTypes: Api.ActionType[];
        meta?: undefined;
      }
    | {
        otherUpdateReason: "upgrade_success" | "upgrade_failed";
        actionTypes: [];
        meta: {
          apiVersion: string;
          infraVersion: string;
        };
      }
  );

  export type OrgSocketBroadcastFn = (
    orgId: string,
    msg: OrgSocketUpdateMessage,
    skipDeviceId?: string,
    scope?: {
      userIds?: string[];
      deviceIds?: string[];
    }
  ) => void;

  export interface SocketServer {
    start: (port: number) => void;

    sendOrgUpdate: OrgSocketBroadcastFn;

    clearOrgSockets: (orgId: string) => void;

    clearUserSockets: (orgId: string, userId: string) => void;

    clearDeviceSocket: (
      orgId: string,
      userId: string,
      deviceId: string
    ) => void;
  }
}

export default Api;

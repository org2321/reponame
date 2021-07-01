import { sha256 } from "@core/lib/crypto/utils";
import express, { RequestHandler } from "express";
import { errorFallbackMiddleware } from "./errors";
import bodyParser from "body-parser";
import localSocketServer from "./socket";
import { Api } from "@core/types";
import * as R from "ramda";
import { log } from "@core/lib/utils/logger";
import fetch from "node-fetch";
import { env } from "../../../shared/src/env";
import { health } from "./routes";

type ClusterFn = Exclude<keyof Api.SocketServer, "start">;

type AgentRequestParams = { fn: ClusterFn; args: any[]; auth: string };

let agentPort: number;
let hostGetter: () => Promise<string[]>;

// we'll use a fargate metadata getter func, but theoertically any function returning a list of hosts would work
export const registerHostGetter = (hostGetterFunc: () => Promise<string[]>) => {
  hostGetter = hostGetterFunc;
};

const start: Api.SocketServer["start"] = (port: number) => {
    agentPort = port;
    localSocketServer.start(port + 1);

    const clusterAgent = express();
    clusterAgent.disable("x-powered-by");

    clusterAgent.get("/", (req, res) => res.end("Cluster Agent OK"));
    clusterAgent.get("/health", health);
    clusterAgent.use(bodyParser.json({ limit: "10kb" }));

    clusterAgent.post("/cluster-agent", requireJson, onPost);

    clusterAgent.use(errorFallbackMiddleware);

    clusterAgent.listen(agentPort, () => {
      log(`Socket cluster agent is waiting for commands on port ${port}.`);
    });
  },
  requireJson: RequestHandler<{}, {}, AgentRequestParams> = (
    req,
    res,
    next
  ) => {
    if (!req.is("json")) {
      return res.send(400).send("Bad request - expected application/json");
    }
    next();
  },
  onPost: RequestHandler<{}, {}, AgentRequestParams> = (req, res) => {
    const fromPeer = req.ip + ":" + req.socket.remotePort;
    log("Received POST /cluster-agent", {
      fn: req.body.fn,
      fromPeer,
    });

    if (!env.SOCKET_CLUSTER_AUTH) {
      return res.status(500).send("Server error - missing cluster auth config");
    }
    if (!req.body.auth) {
      log("POST /cluster-agent auth failed", { fn: req.body.fn, fromPeer });
      return res.status(401).send("Unauthorized - missing auth body");
    }
    if (sha256(env.SOCKET_CLUSTER_AUTH!) !== sha256(req.body.auth)) {
      log("POST /cluster-agent auth failed", { fn: req.body.fn, fromPeer });
      setTimeout(() => res.status(401).send("Unauthorized"), 500);
      return;
    }

    const noBodyFuncRequested = !req.body.fn;
    const noRemoteMethodsRequested = !remoteMethods.includes(req.body.fn);
    if (noBodyFuncRequested || noRemoteMethodsRequested) {
      log("POST /cluster-agent bad fn body", {
        noBodyFuncRequested,
        noRemoteMethodsRequested,
        fromPeer,
      });
      res.status(400).send("Bad request - fn body");
      return;
    }

    R.apply(localSocketServer[req.body.fn], req.body.args);
    log("Applied POST /cluster-agent to connected clients", {
      fn: req.body.fn,
      fromPeer,
    });
    res.status(200).send("Ok");
  },
  clusterMethod = (fn: ClusterFn, ...args: any[]) => {
    R.apply(localSocketServer[fn], args);
    if (!hostGetter) {
      return;
    }
    hostGetter()
      .then((ips) =>
        ips.forEach((ip) => {
          const url = `http://${ip}:${agentPort}/cluster-agent`,
            params: AgentRequestParams = {
              fn,
              args,
              auth: env.SOCKET_CLUSTER_AUTH!,
            };
          fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(params),
            timeout: 2000,
          }).catch((err) => {
            log("Post to cluster peer failed", { url, err });
          });
        })
      )
      .catch((err) => {
        log("Fetching cluster host ips from db failed with err:", { err });
      });
  },
  sendOrgUpdate: Api.SocketServer["sendOrgUpdate"] = (
    orgId,
    msg,
    skipDeviceId,
    scope
  ) => clusterMethod("sendOrgUpdate", orgId, msg, skipDeviceId, scope),
  clearDeviceSocket: Api.SocketServer["clearDeviceSocket"] = (
    orgId,
    userId,
    deviceId
  ) => clusterMethod("clearDeviceSocket", orgId, userId, deviceId),
  clearUserSockets: Api.SocketServer["clearUserSockets"] = (orgId, userId) =>
    clusterMethod("clearUserSockets", orgId, userId),
  clearOrgSockets: Api.SocketServer["clearOrgSockets"] = (orgId) =>
    clusterMethod("clearOrgSockets", orgId);

const socketCluster: Api.SocketServer = {
  start,
  sendOrgUpdate,
  clearOrgSockets,
  clearUserSockets,
  clearDeviceSocket,
};

const remoteMethods = R.without(
  ["start"],
  Object.keys(socketCluster)
) as (keyof Omit<typeof socketCluster, "start">)[];

export default socketCluster;

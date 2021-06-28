import * as R from "ramda";
import WebSocket from "ws";
import url from "url";
import { IncomingMessage, createServer } from "http";
import { Auth, Api } from "@core/types";
import { log } from "@core/lib/utils/logger";
import { authenticate } from "../../../shared/src/auth";
import { okResult } from "./routes/route_helpers";
import { upTo1Sec, wait } from "@core/lib/utils/wait";

type RawSocket = IncomingMessage["socket"];

let socketServer: WebSocket.Server;

const HEARTBEAT_INTERVAL_MILLIS = 25000;

const connections: {
  [orgId: string]: {
    [userId: string]: {
      [deviceId: string]: WebSocket;
    };
  };
} = {};

const start: Api.SocketServer["start"] = (port: number) => {
    const httpServer = createServer((req, res) => {
      const { pathname } = url.parse(<string>req.url);
      if (pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Socket Server OK");
        return;
      }
      if (pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(okResult));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });
    socketServer = new WebSocket.Server({ noServer: true });

    let heartbeatTimeout: NodeJS.Timeout;
    const pingAllClientsHeartbeat = async () => {
      for (const wsClient of socketServer.clients) {
        if (wsClient.readyState != WebSocket.OPEN) {
          continue;
        }

        // background
        wait(upTo1Sec()).then(() => {
          wsClient.ping((err: Error | null) => {
            // @ts-ignore
            const clientInfo = wsClient._socket?._peername;
            if (err) {
              log("Client WebSocket ping ended with error", {
                err,
                client: clientInfo,
              });
            }
            // logDevOnly("Client WebSocket ping OK", { client: clientInfo });
          });
        });
      }
      heartbeatTimeout = setTimeout(
        pingAllClientsHeartbeat,
        HEARTBEAT_INTERVAL_MILLIS
      );
    };

    socketServer.on(
      "connection",
      (
        socket: WebSocket,
        req: IncomingMessage,
        context: Auth.TokenAuthContext
      ) => {
        if (!connections[context.org.id]) {
          connections[context.org.id] = {};
        }

        if (!connections[context.org.id][context.user.id]) {
          connections[context.org.id][context.user.id] = {};
        }

        clearDeviceSocket(
          context.org.id,
          context.user.id,
          context.orgUserDevice.id
        );

        connections[context.org.id][context.user.id][
          context.orgUserDevice.id
        ] = socket;
        socket.on("close", getClearSocketFn("close", context));
        socket.on("error", getClearSocketFn("error", context));

        log("Websocket client connected", {
          fromAddr: req.socket.remoteAddress + ":" + req.socket.remotePort,
          org: context.org.name,
          email: context.user.email,
          device: context.orgUserDevice.name,
          userId: context.user.id,
        });
      }
    );

    httpServer.on(
      "upgrade",
      (req: IncomingMessage, socket: RawSocket, head) => {
        const fromAddr = req.socket.remoteAddress + ":" + req.socket.remotePort;
        log("Websocket connection attempt", {
          fromAddr,
        });

        if (typeof req.headers["authorization"] != "string") {
          log("Websocket authorization header missing", { fromAddr });
          socketAuthErr(socket);
          return;
        }

        const authParams = JSON.parse(
          req.headers["authorization"]
        ) as Auth.ApiAuthParams;

        authenticate<Auth.TokenAuthContext>(authParams)
          .then((context) => {
            socketServer.handleUpgrade(req, socket, head, function done(ws) {
              socketServer.emit("connection", ws, req, context);
            });
          })
          .catch((err) => {
            log("socket httpServer.authenticate error", { err });
            socketAuthErr(socket);
            return;
          });
      }
    );

    httpServer.listen(port, () => {
      log(`Socket server waiting for connections`, {
        port,
        heartbeatIntervalMillis: HEARTBEAT_INTERVAL_MILLIS,
      });

      heartbeatTimeout = setTimeout(
        pingAllClientsHeartbeat,
        HEARTBEAT_INTERVAL_MILLIS
      );

      socketServer.on("close", () => clearTimeout(heartbeatTimeout));
    });
  },
  sendOrgUpdate: Api.SocketServer["sendOrgUpdate"] = (
    orgId,
    msg,
    skipDeviceId,
    scope
  ) => {
    const byUserId = connections[orgId] ?? {};
    log("Dispatching client socket update", { orgId });
    let devicesPublishedTo = 0;
    for (let userId in byUserId) {
      if (scope && scope.userIds && !scope.userIds.includes(userId)) {
        continue;
      }

      const byDeviceId = byUserId[userId] ?? {};
      for (let deviceId in byDeviceId) {
        if (deviceId == skipDeviceId) {
          continue;
        }
        if (scope && scope.deviceIds && !scope.deviceIds.includes(deviceId)) {
          continue;
        }
        const conn = byDeviceId[deviceId];
        if (conn.readyState == WebSocket.OPEN) {
          conn.send(JSON.stringify(msg));
          devicesPublishedTo++;
        }
      }
    }

    log("Dispatched client socket update", { orgId, devicesPublishedTo });
  },
  clearDeviceSocket: Api.SocketServer["clearDeviceSocket"] = (
    orgId,
    userId,
    deviceId
  ) => {
    if (
      connections[orgId] &&
      connections[orgId][userId] &&
      connections[orgId][userId][deviceId]
    ) {
      log("Clearing socket", { orgId, userId, deviceId });
      const conn = connections[orgId][userId][deviceId];
      if (conn) {
        try {
          conn.removeAllListeners();
          conn.close();
        } catch (err) {
          log("Error closing socket:", { err, orgId, userId, deviceId });
        }
      }

      delete connections[orgId][userId][deviceId];

      if (R.isEmpty(connections[orgId][userId])) {
        delete connections[orgId][userId];
      }

      if (R.isEmpty(connections[orgId])) {
        delete connections[orgId];
      }
    }
  },
  clearUserSockets: Api.SocketServer["clearUserSockets"] = (orgId, userId) => {
    if (connections[orgId] && connections[orgId][userId]) {
      const byDeviceId = connections[orgId][userId];
      for (let deviceId in byDeviceId) {
        clearDeviceSocket(orgId, userId, deviceId);
      }
    }
  },
  clearOrgSockets: Api.SocketServer["clearOrgSockets"] = (orgId) => {
    if (connections[orgId]) {
      const byUserId = connections[orgId];
      for (let userId in byUserId) {
        clearUserSockets(orgId, userId);
      }
    }
  },
  socketAuthErr = (socket: RawSocket) => {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.removeAllListeners();
    socket.destroy();
  },
  getClearSocketFn = (
    type: "close" | "error",
    context: Auth.TokenAuthContext
  ) => () => {
    log(`Received ${type} web socket event`, {
      org: context.org.name,
      email: context.user.email,
      device: context.orgUserDevice.name,
    });
    clearDeviceSocket(
      context.org.id,
      context.user.id,
      context.orgUserDevice.id
    );
  };

const res: Api.SocketServer = {
  start,
  sendOrgUpdate,
  clearOrgSockets,
  clearUserSockets,
  clearDeviceSocket,
};
export default res;

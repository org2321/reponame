import { log, logStderr } from "@core/lib/utils/logger";
import { ensureEnv, env } from "../../../shared/src/env";
import express from "express";
import initRoutes from "./routes";
import bodyParser from "body-parser";
import { failoverLogsLoop } from "../../../shared/src/replication";
import socketCluster from "./socket_cluster";
import { initCheckHostPeers, initHostRegistration } from "./hosts";
import { registerSocketServer } from "../../../shared/src/handler";
import { runMigrationsIfNeeded } from "./migrate";
import { setMaxPacketSize } from "../../../shared/src/db";

process.on("uncaughtException", (err) => {
  logStderr("uncaughtException", { err });
  // flush that log buffer before suicide
  setTimeout(() => {
    process.exit(1);
  }, 200);
});

process.on("unhandledRejection", (reason, promise) => {
  logStderr("Unhandled Rejection at:", { promise, reason });
});

ensureEnv("SOCKET_CLUSTER_AUTH");

if (env.SERVER_MODE == "api_only" || env.SERVER_MODE == "combined") {
  require("../../../shared/src/api_handlers");
}

if (env.SERVER_MODE == "fetch_only" || env.SERVER_MODE == "combined") {
  require("../../../shared/src/fetch_handlers");
}

const app = express(),
  port = env.EXPRESS_PORT ? parseInt(env.EXPRESS_PORT) : 3000;

app.use(bodyParser.json({ limit: "200mb" }));

const DELAY_WAITING_FOR_AWS_METADATA_SERVICE = 5000;
if (process.env.NODE_ENV === "production") {
  setTimeout(failoverLogsLoop, DELAY_WAITING_FOR_AWS_METADATA_SERVICE);
}

export default (injectHandlers: (app: express.Application) => void) => {
  // init routes after the caller of startup(app) so they can attach any routes before
  // we initRoutes(app) and add the 404 and final error handler
  injectHandlers(app);
  initRoutes(app);

  return runMigrationsIfNeeded()
    .then(() => setMaxPacketSize())
    .then(() => {
      if (process.env.NODE_ENV === "production") {
        return initHostRegistration(DELAY_WAITING_FOR_AWS_METADATA_SERVICE);
      }
    })
    .then(() => {
      socketCluster.start(port + 1);
      initCheckHostPeers(port + 1);
      registerSocketServer(socketCluster);

      const server = app.listen(port, () => {
        log(`EnvKey Api running via express runtime on port ${port}!`);
      });

      const apiVersionNumberOnStartup = env.API_VERSION_NUMBER;
      const infraVersionNumberOnStartup = env.INFRA_VERSION_NUMBER;

      if (env.NODE_ENV === "production") {
        log("API init with versions", {
          apiVersionNumberOnStartup,
          infraVersionNumberOnStartup,
        });
      }

      return {
        server,
        socketServer: socketCluster,
      };
    });
};

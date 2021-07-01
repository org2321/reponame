import { log, logStderr } from "@core/lib/utils/logger";
import { ensureEnv, env } from "../../../shared/src/env";
import express from "express";
import initRoutes from "./routes";
import bodyParser from "body-parser";
import { runMigrationsIfNeeded } from "./migrate";
import { setMaxPacketSize } from "../../../shared/src/db";
import { registerSocketServer } from "../../../shared/src/handler";
import socketCluster from "./socket_cluster";

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

ensureEnv();

if (env.SERVER_MODE == "api_only" || env.SERVER_MODE == "combined") {
  require("../../../shared/src/api_handlers");
}

if (env.SERVER_MODE == "fetch_only" || env.SERVER_MODE == "combined") {
  require("../../../shared/src/fetch_handlers");
}

const app = express();
const port = env.EXPRESS_PORT ? parseInt(env.EXPRESS_PORT) : 3000;

app.use(bodyParser.json({ limit: "200mb" }));

export default (
  injectHandlers: (app: express.Application) => void,
  afterDbCallback?: (port: number) => Promise<void>
) => {
  // init routes after the caller of startup(app) so they can attach any routes before
  // we initRoutes(app) and add the 404 and final error handler
  injectHandlers(app);
  initRoutes(app);

  return runMigrationsIfNeeded()
    .then(() => setMaxPacketSize())
    .then(async () => {
      socketCluster.start(port + 1);
      registerSocketServer(socketCluster);
      if (afterDbCallback) {
        await afterDbCallback(port);
      }

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
      };
    });
};

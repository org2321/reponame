if (process.env.NODE_ENV !== "production") {
  const path = require("path");
  const dotenv = require("dotenv");
  dotenv.config();
  dotenv.config({ path: path.resolve(process.cwd(), ".community.env") });
}

import { log } from "@core/lib/utils/logger";
import startup from "./startup";

log("EnvKey API Community Edition is starting...");

const injectHandlers = () => {};

startup(injectHandlers)
  .then(() => {
    log("EnvKey API Community Edition has started!");
  })
  .catch((err) => {
    log("Initialization error:", { err });
    throw err;
  });

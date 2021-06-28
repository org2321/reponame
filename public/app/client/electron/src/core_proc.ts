import { log } from "@core/lib/utils/logger";
import { start } from "@core_proc/server";
import { isAlive } from "@core/lib/core_proc";

let shutdownNetworking: () => void;

export const startCoreFromElectron = async (): Promise<void> => {
  let alive = await isAlive();
  if (alive) {
    log("Core process is already running");
    return;
  }
  log("Starting core_process inline");
  ({ shutdownNetworking } = await start(19047, 19048));

  while (true) {
    alive = await isAlive();
    if (alive) {
      break;
    }
  }

  log("Successfully started core process");
};

export const stopCoreProcess = () => {
  if (shutdownNetworking) {
    shutdownNetworking();
  }
};

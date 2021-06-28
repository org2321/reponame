import { Client } from "../../types";
import {
  get,
  put,
  del,
  enableLogging as fileStoreEnableLogging,
} from "./file_store";
import { enableLogging as keyStoreEnableLogging } from "./key_store";
import { pick } from "../utils/object";

const STATE_KEY = "local-state";

const queue: Client.ProcState[] = [];

export const queuePersistState = (state: Client.ProcState) => {
    queue.push(state);
    if (queue.length == 1) {
      processPersistStateQueue();
    }
  },
  processPersistStateQueue = async () => {
    const state = queue.shift();

    if (!state) {
      return;
    }

    await put(STATE_KEY, pick(Client.STATE_PERSISTENCE_KEYS, state));

    if (queue.length > 0) {
      await processPersistStateQueue();
    }
  },
  getPersistedState = () =>
    get(STATE_KEY) as Promise<Client.PersistedProcState>,
  deletePersistedState = () => del(STATE_KEY),
  enableLogging = () => {
    fileStoreEnableLogging();
    keyStoreEnableLogging();
  };

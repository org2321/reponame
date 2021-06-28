import { version } from "../package.json";
import { Client } from "@core/types";

export const getContext = (
  accountIdOrCliKey?: string,
  store?: Client.ReduxStore
): Client.Context => ({
  client: {
    clientName: "core",
    clientVersion: version,
  },
  clientId: "core",
  accountIdOrCliKey,
  store,
});

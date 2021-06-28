import { Client } from "../../types";
import crossFetch, { FetchRequestInit } from "../utils/cross_fetch";
import { v4 as uuid } from "uuid";

export const clientId = uuid(), // unique per client (ephemeral)
  CORE_PROC_PORT = "19047",
  coreMethod = async (
    method: string,
    encryptedAuthToken?: string,
    args?: FetchRequestInit,
    query?: Record<string, string>
  ) => {
    return crossFetch(
      `http://localhost:${CORE_PROC_PORT}/${method}${
        query ? "?" + new URLSearchParams(query).toString() : ""
      }`,
      {
        timeout: 20000,
        ...(args ?? {}),
        headers: {
          ...(args?.headers ?? {}),
          // in the browser / electron, user-agent is set via args to browser process
          // so this only applies on node
          ...(typeof window == "undefined" && encryptedAuthToken
            ? {
                "User-Agent": `${Client.CORE_PROC_AGENT_NAME}|Node|${encryptedAuthToken}`,
              }
            : {}),
        },
      }
    );
  },
  coreMethodJson = <T extends {}>(
    method: string,
    encryptedAuthToken?: string,
    args?: FetchRequestInit,
    query?: Record<string, string>
  ) =>
    coreMethod(method, encryptedAuthToken, args, query).then(
      (res) =>
        res.json().then((json) => ({ ...json, status: res.status })) as Promise<
          T & { status: number }
        >
    ),
  // TODO: also check if web socket is alive
  isAlive = () =>
    coreMethod("alive", undefined, { timeout: 200 })
      .then((res) => res.ok)
      .catch((err) => {
        return false;
      }),
  fetchState = (accountIdOrCliKey?: string, encryptedAuthToken?: string) =>
    coreMethodJson<Client.State>("state", encryptedAuthToken, undefined, {
      clientId,
      ...(accountIdOrCliKey ? { accountIdOrCliKey } : {}),
    }),
  dispatchCore = async <T extends Client.Action.EnvkeyAction>(
    action: Client.Action.DispatchAction<T>,
    clientParams: Client.ClientParams<"cli" | "app">,
    accountIdOrCliKey: string | undefined,
    hostUrlOverride?: string,
    encryptedAuthToken?: string
  ) =>
    coreMethodJson<Client.DispatchResult>(
      "action",
      encryptedAuthToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          context: {
            client: clientParams,
            accountIdOrCliKey,
            clientId,
            hostUrl: hostUrlOverride,
          },
        }),
      },
      undefined
    );

import { env } from "../../../shared/src/env";
import { pool } from "../../../shared/src/db";
import { log } from "@core/lib/utils/logger";
import crossFetch from "@core/lib/utils/cross_fetch";

const HOST_REGISTRATION_INTERVAL_MS = 1000 * 10, // 10 seconds,
  HOST_EVICTION_MISSED_HEARTBEATS = 3, // evict hosts if they miss 3 consecutive heartbeats
  HOST_EVICTION_SECONDS =
    (HOST_REGISTRATION_INTERVAL_MS / 1000) * HOST_EVICTION_MISSED_HEARTBEATS;

let SET_HOST_QUERY_STRING: string | undefined;
let LAST_IP: string | undefined;

export const getLastHostIP = () => LAST_IP;

const getHostQueryString = async (): Promise<string> => {
  if (SET_HOST_QUERY_STRING) {
    return SET_HOST_QUERY_STRING;
  }
  return crossFetch("http://169.254.170.2/v2/metadata", { timeout: 5000 })
    .then((res) => {
      if (res.status != 200) {
        return res.text().then((t) => {
          throw new Error(
            `Error response from AWS internal local-ipv4 endpoint: ${t}`
          );
        });
      }
      return res.json();
    })
    .then((metadata) => {
      const ownIP = metadata?.Containers[0]?.Networks[0]?.IPv4Addresses[0];
      if (!ownIP) {
        throw new Error(
          `Unable to find container IP for cluster host services. ${JSON.stringify(
            metadata
          )}`
        );
      }
      log(`Fetched internal IP from aws metadata service: ${ownIP}`);
      SET_HOST_QUERY_STRING = `SET @hostAddr = '${ownIP}';`;
      LAST_IP = ownIP;
      return SET_HOST_QUERY_STRING;
    });
};

let registerHostTimeout: ReturnType<typeof setTimeout> | undefined;

const registerHost = async () => {
    let setIP: string;
    try {
      setIP = await getHostQueryString();
    } catch (err) {
      log(`registerHost cannot get own IP, skipping.`, { err });
      return;
    }
    const res = await pool.query(`
      ${setIP}
      DELETE FROM active_hosts WHERE TIME_TO_SEC(TIMEDIFF(NOW(), activeAt)) > ${HOST_EVICTION_SECONDS};
      INSERT INTO active_hosts (hostAddr) VALUES (@hostAddr)
      ON DUPLICATE KEY UPDATE activeAt = CURRENT_TIMESTAMP;
    `);
    registerHostTimeout = setTimeout(
      registerHost,
      HOST_REGISTRATION_INTERVAL_MS
    );

    return res;
  },
  deregisterHost = async () => {
    let setIP: string;
    try {
      setIP = await getHostQueryString();
    } catch (err) {
      log(`deregisterHost cannot get own IP, skipping.`, { err });
      return;
    }
    log("De-registering host.");
    if (registerHostTimeout) {
      clearTimeout(registerHostTimeout);
    }
    return pool.query(`
      ${setIP}
      DELETE FROM active_hosts WHERE hostAddr = @hostAddr;
    `);
  };

export const initHostRegistration = async (waitMillis?: number) => {
    log(
      `Initializing host registration. Will send heartbeat every ${HOST_REGISTRATION_INTERVAL_MS}ms. Hosts will be evicted after ${HOST_EVICTION_MISSED_HEARTBEATS} missed heartbeats.`
    );

    if (waitMillis) {
      setTimeout(registerHost, waitMillis);
    } else {
      // inline wait
      await registerHost();
    }

    log("Host registration loop initialized.");

    for (let exitSignal of ["SIGTERM", "SIGINT"]) {
      process.on(exitSignal, () => {
        log(`Received ${exitSignal} - deregistering host before exiting...`);
        deregisterHost()
          .then(() => process.exit(0))
          .catch((err) => {
            log("Error deregistering host:", { err });
            process.exit(1);
          });
      });
    }
  },
  getOtherActiveHosts = async () => {
    if (env.NODE_ENV == "development") {
      return [];
    }
    let setIP: string;
    try {
      setIP = await getHostQueryString();
    } catch (err) {
      log(`getOtherActiveHosts cannot get own IP, skipping.`, { err });
      return [];
    }
    const [[, rows]] = (<any>await pool.query(`
      ${setIP}
      SELECT hostAddr FROM active_hosts WHERE NOT (hostAddr = @hostAddr);
    `)) as [[any, { hostAddr: string }[]]];
    const hosts = rows.map(({ hostAddr }) => hostAddr);
    // log("Other active hosts in DB", { hosts });
    return hosts;
  };

export const initCheckHostPeers = (agentPort: number) => {
  // Not async
  getOtherActiveHosts()
    .then((ips) =>
      Promise.all(
        ips.map((ip) => {
          const url = `http://${ip}:${agentPort}/health`;
          return crossFetch(url, { timeout: 5000 })
            .then((res) => {
              if (res.status !== 200) {
                return res.text().then((text) => {
                  throw new Error(
                    `Cluster peer crossFetch error response ${res.status} - ${text}`
                  );
                });
              }
              return res.text().then((text) => {
                log(`Cluster peer OK`, { url, text });
              });
            })
            .catch((err) => {
              log(`Healthcheck failed to cluster peer`, { url, err });
              // does not rethrow
            });
        })
      )
    )
    .catch((err) => {
      log(`Cluster healthcheck failure`, { err });
      // does not rethrow
    });
};

import { Api, Client, Graph, Model } from "@core/types";
import { BaseArgs, DetectedEnvkey } from "./types";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { sha256 } from "@core/lib/crypto/utils";
import { getCoreProcAuthToken } from "@core/lib/client_store/key_store";
import { fetchState } from "@core/lib/core_proc";
import {
  getEnvironmentName,
  getEnvironmentsByEnvParentId,
  graphTypes,
} from "@core/lib/graph";
import { dispatch } from "./lib/core";
import chalk from "chalk";

export const firstArgIsEnvironment = (
  graph: Graph.Graph,
  appId: string,
  firstArg?: string
): boolean => {
  return Boolean(
    getEnvironmentsByEnvParentId(graph)?.[appId]?.find((env) =>
      [getEnvironmentName(graph, env.id).toLowerCase(), env.id].includes(
        firstArg?.toLowerCase() || ""
      )
    )
  );
};

export const logDetectedAccount = (detected: DetectedEnvkey): void => {
  console.log(
    `Detected account ${chalk.bold(detected.orgName)} from ENVKEY ${chalk.bold(
      detected.foundEnvkey.substring(0, 4)
    )}****** set in ${
      detected.envkeyFromEnvironment
        ? "environment"
        : ".env file at " + chalk.bold(detected.dotenvFile)
    }`
  );
};

// teturns true if successfully performed override on account. You MUST re-exec (or at least re-auth).
export const tryApplyEnvkeyOverride = (
  userId: string,
  argv: BaseArgs
): boolean => {
  const hasNoAccountArgv =
    !argv["account"] && // important: infinite loop protection due to passing --account
    !argv["cli-envkey"] &&
    !argv["org"];
  const hasOverride =
    Boolean(argv["detectedEnvkey"] && argv["detectedEnvkey"].accountId !== userId);
  const canReExec = hasNoAccountArgv && hasOverride;
  if (canReExec) {
    argv["account"] = argv["detectedEnvkey"]!.accountId;
    logDetectedAccount(argv["detectedEnvkey"]!);
    return true;
  }
  return false;
};

// Precedence: look in local directory snf up for .env file, then look in environment vars.
export const detectAppFromEnv = async (
  state: Client.State,
  argv: BaseArgs,
  workingDir: string
): Promise<DetectedEnvkey | undefined> => {
  const logVerbose = argv["verbose"] ? console.error : (...args: any) => {};
  let dotenvFile: string = "";

  const recurseFindEnvkey = async (
    presentDir: string
  ): Promise<string | undefined> => {
    dotenvFile = path.join(presentDir, ".env");
    try {
      logVerbose("detectAppFromEnv checking for .env:", presentDir);
      const envBuf = await fs.promises.readFile(dotenvFile).catch((err) => {
        if (err.code === "ENOENT") {
          return null;
        }
      });
      if (envBuf) {
        logVerbose("detectAppFromEnv found .env:", dotenvFile);
        const envVars = dotenv.parse(envBuf);
        if (envVars.ENVKEY) {
          logVerbose(
            "detectAppFromEnv found ENVKEY:",
            envVars.ENVKEY.substring(0, 4) + "****"
          );
          return envVars.ENVKEY;
        }
      }
    } catch (ignored) {
      logVerbose("detectAppFromEnv warning:", ignored);
      return;
    }
    // bump one up
    const nextDir = path.resolve(presentDir, "../"); // up one
    // resolve won't recurse past "C:\\" or "/" and keep returning the same
    if (
      !nextDir ||
      // top of posix fs
      nextDir === "/" ||
      // top of win32 without mount letter
      nextDir.slice(1) === ":\\"
    ) {
      return;
    }
    return recurseFindEnvkey(nextDir);
  };

  let foundEnvkey = await recurseFindEnvkey(path.normalize(workingDir));
  if (!foundEnvkey) {
    dotenvFile = "";
    foundEnvkey = process.env.ENVKEY;
    if (foundEnvkey) {
      logVerbose("Using ENVKEY from env var");
    }
  }
  if (!foundEnvkey) {
    return;
  }

  // lookup the envkey locally
  const envkeyParts = foundEnvkey.split("-");
  const envkeyIdPart = envkeyParts[0];
  const possibleEnvkeyHost = envkeyParts.slice(2).join("-");
  const envkeyIdPartHash = sha256(envkeyIdPart);
  const accountIds = Object.keys(state.orgUserAccounts);
  const encryptedAuthToken = await getCoreProcAuthToken();
  let s: Client.State;
  let matchedEnvkey: Model.GeneratedEnvkey | undefined;
  let appId: string | undefined;
  let orgId: string | undefined;

  logVerbose("detectAppFromEnv searching for id part hash", envkeyIdPartHash);

  for (let accountId of accountIds) {
    s = await fetchState(accountId, encryptedAuthToken);
    matchedEnvkey = graphTypes(s.graph).generatedEnvkeys.find((key) => {
      logVerbose("detectAppFromEnv checking key id hash", key.envkeyIdPartHash);
      return key.envkeyIdPartHash === envkeyIdPartHash;
    });
    if (!matchedEnvkey) {
      logVerbose("detectAppFromEnv not in accountId", accountId);
      continue;
    }
    const out = {
      appId: matchedEnvkey.appId!,
      appName: (s.graph[matchedEnvkey.appId] as Model.App)?.name + "",
      orgName: s.orgUserAccounts[accountId]!.orgName,
      accountId,
      dotenvFile,
      foundEnvkey,
      envkeyFromEnvironment: !dotenvFile,
    } as DetectedEnvkey;
    logVerbose("detectAppFromEnv matched", out);
    return out;
  }

  logVerbose(
    "detectAppFromEnv did not find account, now looking up external",
    possibleEnvkeyHost
  );

  try {
    const res = await dispatch(
      {
        type: Api.ActionType.CHECK_ENVKEY,
        payload: {
          envkeyIdPart,
        },
      },
      undefined,
      possibleEnvkeyHost
    );
    if (!res.success) {
      logVerbose(
        "detectAppFromEnv failed external lookup",
        res.resultAction ?? res
      );
      return;
    }
    ({ appId, orgId } = (res.resultAction as any)?.payload ?? {});
  } catch (err) {
    logVerbose("detectAppFromEnv fetch crash", err);
    return;
  }

  if (!appId || !orgId) {
    return;
  }
  logVerbose("detectAppFromEnv fetch envkey attrs", { appId, orgId });
  const account = Object.values(state.orgUserAccounts).find(
    (a) => a?.orgId === orgId
  ) as Client.ClientUserAuth | undefined;
  if (!account?.userId) {
    console.error(
      `Detected ENVKEY ${foundEnvkey.substring(0, 4)}***** from ${
        dotenvFile || "environment"
      }, but there is no corresponding local logged in account.\nDo you need to accept an invitation, sign in, or request access?`
    );
    return;
  }

  s = await fetchState(account.userId, encryptedAuthToken);

  const out = {
    accountId: account.userId,
    appId,
    appName: (s.graph[appId] as Model.App)?.name + "",
    orgName: account!.orgName,
    dotenvFile,
    foundEnvkey,
    envkeyFromEnvironment: !dotenvFile,
  };
  logVerbose("detectAppFromEnv matched externally", out);
  return out;
};

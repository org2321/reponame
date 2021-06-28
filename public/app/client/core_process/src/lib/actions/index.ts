import { env, getDefaultApiHostUrl } from "../../../../shared/src/env";
import * as R from "ramda";
import fetch, { RequestInit } from "node-fetch";
import { Api } from "@core/types";
import { log } from "@core/lib/utils/logger";
import argv from "../../argv";
import https from "https";
import {
  FAKE_FARGATE_API_HOST,
  loadTestingChooseHost,
} from "@core_proc/load_testing";

const API_REQUEST_TIMEOUT = 120 * 1000;

export const postApiAction = async <
  ActionType extends
    | Api.Action.RequestAction
    | Api.Action.BulkGraphAction = Api.Action.RequestAction,
  ResponseType extends Api.Net.ApiResult = Api.Net.ApiResult
>(
  action: ActionType,
  // hostname sans protocol
  hostUrlArg?: string
) => {
  let hostUrl = "https://" + (hostUrlArg ?? getDefaultApiHostUrl());
  if (env.IS_FARGATE_LOAD_TEST) {
    hostUrl = `http://${loadTestingChooseHost()}`;
  }

  const actionUrl = hostUrl + "/action";
  const fetchParams = {
    method: "POST",
    body: JSON.stringify(action),
    headers: { "Content-Type": "application/json" },
    timeout: API_REQUEST_TIMEOUT,
    // adding an empty `agent` will coerce to https regardless of hostUrl protocol
  } as RequestInit;

  if (env.IS_FARGATE_LOAD_TEST) {
    // enabled requestParams via extractIpHost to be set properly when doing load tests
    // @ts-ignore
    fetchParams.headers["host"] = FAKE_FARGATE_API_HOST;
  }

  if (!env.IS_FARGATE_LOAD_TEST) {
    if (env.ENVKEY_CORE_DEV_ALLOW_INSECURE) {
      fetchParams.agent = new https.Agent({
        rejectUnauthorized: false,
      });
    }
  }

  if (argv.verbose) {
    log("fetchUrl: " + actionUrl);
    log(
      "fetchParams:",
      R.evolve({ body: JSON.parse }, fetchParams as { body: string })
    );
  }

  return fetch(actionUrl, fetchParams).then((res) => {
    if (argv.verbose) {
      log("response status: " + res.status);
    }

    if (res.status >= 400) {
      try {
        return res.json().then((json) => {
          if (argv.verbose) {
            console.log("response error:", JSON.stringify(json, null, 2));
          }
          throw json as Error;
        });
      } catch (err) {
        return res.text().then((text) => {
          if (argv.verbose) {
            log("response error: " + text);
          }

          throw new Error(text);
        });
      }
    }

    return res.json().then((json) => {
      if (argv.verbose) {
        log("response:", json);
      }
      return json as ResponseType;
    });
  });
};

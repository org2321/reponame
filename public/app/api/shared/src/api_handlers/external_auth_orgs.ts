import { apiAction, apiErr } from "../handler";
import { Api } from "@core/types";
import {
  getVerifiedExternalAuthSession,
  findOrCreateExternalAuthProviderIfNeeded,
} from "../models/external_auth";
import {
  resolveEndpointProtocol,
  getProviderSettings,
  parseLinks,
} from "../auth";
import fetch from "node-fetch";

apiAction<
  Api.Action.RequestActions["GetExternalAuthOrgs"],
  Api.Net.ApiResultTypes["GetExternalAuthOrgs"]
>({
  type: Api.ActionType.GET_EXTERNAL_AUTH_ORGS,
  graphAction: false,
  authenticated: true,
  handler: async ({ payload }, auth, now, requestParams, transactionConn) => {
    const externalAuthSession = await getVerifiedExternalAuthSession(
      auth.org.id,
      auth.user.id,
      payload.provider,
      "invite_users"
    );

    if (!externalAuthSession) {
      throw await apiErr(transactionConn, "not found", 404);
    }

    const [externalAuthProvider, transactionItems] =
      await findOrCreateExternalAuthProviderIfNeeded(
        externalAuthSession,
        auth.org.id,
        auth.user.id,
        now
      );

    return getOrgs(externalAuthSession, externalAuthProvider, transactionItems);
  },
});

const getOrgs = async (
  externalAuthSession: Api.Db.ExternalAuthSession,
  externalAuthProvider?: Api.Db.ExternalAuthProvider,
  transactionItems?: Api.Db.ObjectTransactionItems
): Promise<
  Api.HandlerResult<Api.Net.ApiResultTypes["GetExternalAuthOrgs"]>
> => {
  const provider = externalAuthSession.provider,
    providerSettings = getProviderSettings(
      externalAuthSession,
      externalAuthProvider
    );

  if (provider == "github" || provider == "github_hosted") {
    const endpoint =
      provider == "github"
        ? "https://api.github.com"
        : resolveEndpointProtocol(
            [providerSettings!.endpoint.replace(/\/$/, ""), "api/v3"].join("/")
          );

    let orgLogins: Api.Net.ApiResultTypes["GetExternalAuthOrgs"]["orgs"] = {},
      currentPage = 0,
      nextPageUrl = `${endpoint}/user/orgs?access_token=${externalAuthSession.accessToken}`;

    while (true) {
      console.log(`Fetching ${provider} orgs, page: ${currentPage}`);

      const orgRes = await fetch(nextPageUrl).then((res) => {
        const linkHeader = res.headers.get("link");
        if (linkHeader) {
          const links = parseLinks(linkHeader);
          nextPageUrl = links.next;
        }

        return res.json() as Promise<{ login: string }[]>;
      });

      for (let org of orgRes) {
        orgLogins[org.login] = org.login;
      }

      if (!nextPageUrl || currentPage > 4) {
        break;
      }

      currentPage++;
    }

    return {
      type: "handlerResult",
      response: {
        type: "externalAuthOrgs",
        orgs: orgLogins,
      },
      transactionItems,
      logTargetIds: [],
    };
  } else if (provider == "gitlab" || provider == "gitlab_hosted") {
    const endpoint =
      provider == "gitlab"
        ? "https://gitlab.com"
        : resolveEndpointProtocol(
            [providerSettings!.endpoint.replace(/\/$/, ""), "api/v3"].join("/")
          );

    let orgLogins: Api.Net.ApiResultTypes["GetExternalAuthOrgs"]["orgs"] = {},
      currentPage = 0,
      nextPageUrl = `${endpoint}/api/v4/groups?access_token=${externalAuthSession.accessToken}`;

    while (true) {
      console.log(`Fetching ${provider} orgs, page: ${currentPage}`);

      const orgRes = await fetch(nextPageUrl).then((res) => {
        const linkHeader = res.headers.get("link");
        if (linkHeader) {
          const links = parseLinks(linkHeader);
          nextPageUrl = links.next;
        }

        return res.json() as Promise<{ path: string; name: string }[]>;
      });

      for (let org of orgRes) {
        orgLogins[org.path] = org.name;
      }

      if (!nextPageUrl || currentPage > 4) {
        break;
      }

      currentPage++;
    }

    return {
      type: "handlerResult",
      response: {
        type: "externalAuthOrgs",
        orgs: orgLogins,
      },
      transactionItems,
      logTargetIds: [],
    };
  }

  return {
    type: "handlerResult",
    response: {
      type: "externalAuthOrgs",
      orgs: {},
    },
    transactionItems,
    logTargetIds: [],
  };
};

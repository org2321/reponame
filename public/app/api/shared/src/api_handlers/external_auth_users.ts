import { apiAction, apiErr } from "../handler";
import { Api, Model } from "@core/types";
import * as R from "ramda";
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
import naclUtil from "tweetnacl-util";
import { PoolConnection } from "mysql2/promise";

apiAction<
  Api.Action.RequestActions["GetExternalAuthUsers"],
  Api.Net.ApiResultTypes["GetExternalAuthUsers"]
>({
  type: Api.ActionType.GET_EXTERNAL_AUTH_USERS,
  graphAction: false,
  authenticated: true,
  handler: async ({ payload }, auth, now, requestParams, transactionConn) => {
    if (!transactionConn) {
      throw new Error("transaction connection required");
    }

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

    let users = await getUsers(
      transactionConn,
      payload,
      externalAuthSession,
      externalAuthProvider
    );

    if (payload.query) {
      users = users.filter(({ username, firstName, lastName, email }) =>
        [username, firstName, lastName, email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(payload.query!.toLowerCase())
      );
    }

    return {
      type: "handlerResult",
      response: {
        type: "externalAuthUsers",
        users,
      },
      transactionItems,
      logTargetIds: [],
    };
  },
});

const getUsers = async (
    transactionConn: PoolConnection,
    payload: Api.Net.ApiParamTypes["GetExternalAuthUsers"],
    externalAuthSession: Api.Db.ExternalAuthSession,
    externalAuthProvider?: Api.Db.ExternalAuthProvider
  ): Promise<Api.Net.ApiResultTypes["GetExternalAuthUsers"]["users"]> => {
    const provider = externalAuthSession.provider,
      providerSettings = getProviderSettings(
        externalAuthSession,
        externalAuthProvider
      ),
      sanitizedOrgId = (payload.externalAuthOrgId || "").replace(/"/g, "");

    if (provider == "github" || provider == "github_hosted") {
      const endpoint =
          provider == "github"
            ? "https://api.github.com/graphql"
            : resolveEndpointProtocol(
                [
                  providerSettings!.endpoint.replace(/\/$/, ""),
                  "api/graphql",
                ].join("/")
              ),
        authString = `bearer ${externalAuthSession.accessToken}`;

      let currentPage = 1,
        cursor: string | null = null,
        users: Api.Net.ApiResultTypes["GetExternalAuthUsers"]["users"] = [];

      while (true) {
        console.log(
          `Fetching ${provider} users for org: ${sanitizedOrgId}, page: ${currentPage}`
        );

        const graphqlQuery = githubOrgMembersGraphqlQuery(
            cursor,
            sanitizedOrgId
          ),
          [usersPage, hasNextPage, lastCursor] = await fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: authString,
              "User-Agent": "EnvKey Server",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: graphqlQuery,
            }),
          })
            .then(
              (res) =>
                res.json() as Promise<{
                  data: {
                    organization: {
                      membersWithRole: {
                        pageInfo: { hasNextPage: boolean };
                        edges: {
                          cursor: string;
                          node: {
                            name?: string;
                            id: string;
                            login: string;
                          };
                        }[];
                      };
                    };
                  };
                }>
            )
            .then(
              ({
                data: {
                  organization: {
                    membersWithRole: {
                      pageInfo: { hasNextPage },
                      edges,
                    },
                  },
                },
              }) => [
                edges.map(({ node: { name, id, login } }) => {
                  const nameSplit = (name || "").split(" ");
                  return {
                    firstName: nameSplit[0] || "",
                    lastName: R.tail(nameSplit).join(" ") || "",
                    uid: naclUtil
                      .encodeUTF8(naclUtil.decodeBase64(id))
                      .match(/User(.*)$/)![1],
                    username: login,
                  };
                }),
                hasNextPage,
                R.last(edges)?.cursor ?? null,
              ]
            );

        if (Array.isArray(usersPage)) {
          users = users.concat(usersPage);
        }

        if (!hasNextPage || currentPage > 4) {
          break;
        }

        if (typeof lastCursor === "string") {
          cursor = lastCursor;
        } else {
          cursor = null;
        }
        currentPage++;
      }

      return users;
    } else if (provider == "gitlab" || provider == "gitlab_hosted") {
      const endpoint =
        provider == "gitlab"
          ? "https://gitlab.com"
          : resolveEndpointProtocol(providerSettings!.endpoint);

      let currentPage = 1,
        users: Api.Net.ApiResultTypes["GetExternalAuthUsers"]["users"] = [],
        nextPageUrl: string;

      if (provider == "gitlab_hosted") {
        const queryParams = [`access_token=${externalAuthSession.accessToken}`];
        if (payload.query) {
          queryParams.push(`search=${encodeURIComponent(payload.query)}`);
        }
        nextPageUrl = `${endpoint}/api/v4/users?${queryParams.join("&")}`;
      } else {
        nextPageUrl = `${endpoint}/api/v4/groups/${sanitizedOrgId}/members?access_token=${externalAuthSession.accessToken}`;
      }

      while (true) {
        console.log(
          `Fetching ${provider} users for org: ${sanitizedOrgId}, page: ${currentPage}`
        );

        const userRes = await fetch(nextPageUrl).then((res) => {
          const linkHeader = res.headers.get("link");
          if (linkHeader) {
            const links = parseLinks(linkHeader);
            nextPageUrl = links.next;
          }

          return res.json() as Promise<
            {
              id: string;
              username: string;
              name?: string;
            }[]
          >;
        });

        users = users.concat(
          userRes.map(({ id, username, name }) => {
            const nameSplit = (name || "").split(" ");
            return {
              uid: id,
              username,
              firstName: nameSplit[0],
              lastName: R.tail(nameSplit).join(" "),
            };
          })
        );

        if (!nextPageUrl || currentPage > 4) {
          break;
        }
        currentPage++;
      }

      return users;
    } else if (provider == "google") {
      if (!externalAuthSession.domain) {
        throw await apiErr(
          transactionConn,
          "Can't invite users without a Google Apps domain",
          400
        );
      }

      const userRes = await fetch(
        `https://www.googleapis.com/admin/directory/v1/users?domain=${externalAuthSession.domain}&viewType=domain_public&access_token=${externalAuthSession.accessToken}`
      ).then(
        (res) =>
          res.json() as Promise<{
            users: {
              id: string;
              primaryEmail: string;
              name: {
                givenName: string;
                familyName: string;
              };
            }[];
          }>
      );

      return userRes.users.map(
        ({ id, primaryEmail, name: { givenName, familyName } }) => ({
          uid: id,
          email: primaryEmail,
          firstName: givenName,
          lastName: familyName,
        })
      );
    }

    return [];
  },
  githubOrgMembersGraphqlQuery = (
    cursor: string | null,
    externalAuthOrgId?: string
  ) => {
    const queryParams = ["first:100"];
    if (cursor) {
      queryParams.push(`after: "${cursor}"`);
    }

    return `{
  organization(login: "${externalAuthOrgId}") {
    membersWithRole(${queryParams.join(", ")}) {
      totalCount
      edges {
        node {
          id
          login
          name
          email
        }
        cursor
      }
      pageInfo {
        hasNextPage
      }
    }
  }
}`;
  };

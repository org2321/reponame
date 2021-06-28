import { v4 as uuid } from "uuid";
import * as R from "ramda";
import { Api, Auth } from "@core/types";
import { query, getDb } from "../db";
import { apiErr } from "../handler";

export const getNonSamlExternalAuthSessionSkey = (params: {
    orgId: string | undefined;
    userId: string | undefined;
    provider: Auth.ExternalAuthProviderType;
    authType: Auth.AuthType;
  }) =>
    [params.orgId, params.userId, params.provider, params.authType]
      .filter(Boolean)
      .join("|"),
  getExternalAuthProvidersList = async (
    orgId: string
  ): Promise<Api.Db.ExternalAuthProvider[]> =>
    query<Api.Db.ExternalAuthProvider>({
      pkey: orgId,
      scope: "g|externalAuthProvider",
    }),
  getExternalAuthProvider = async (
    orgId: string,
    externalAuthProviderId: string
  ): Promise<Api.Db.ExternalAuthProvider | undefined> => {
    const p = await getDb<Api.Db.ExternalAuthProvider>({
      pkey: orgId,
      skey: `g|externalAuthProvider|${externalAuthProviderId}`,
    });
    if (!p) {
      return undefined;
    }
    if (p.deletedAt) {
      throw await apiErr(
        undefined,
        "The external auth provider has been deleted",
        410
      );
    }
    return p;
  },
  mustGetExternalAuthProvider = async (
    orgId: string,
    externalAuthProviderId: string
  ): Promise<Api.Db.ExternalAuthProvider> => {
    const p = await getExternalAuthProvider(orgId, externalAuthProviderId);
    if (!p) {
      throw await apiErr(
        undefined,
        `cannot find external auth provider ${externalAuthProviderId} for org ${orgId}`,
        404
      );
    }
    return p;
  },
  getVerifiedExternalAuthSession = async (
    orgId: string | undefined,
    userId: string | undefined,
    provider: Auth.ExternalAuthProviderType,
    authType: Auth.AuthType
  ): Promise<Api.Db.ExternalAuthSession | undefined> => {
    const sessions = await query<Api.Db.ExternalAuthSession>({
      scope: getNonSamlExternalAuthSessionSkey({
        orgId,
        userId,
        provider,
        authType,
      }),
    });

    return R.last<Api.Db.ExternalAuthSession | undefined>(
      R.sortBy(
        R.prop("verifiedAt") as any,
        sessions.filter((session) => session.verifiedAt)
      )
    );
  },
  createExternalAuthProviderIfNeeded = async (
    externalAuthSession: Api.Db.ExternalAuthSession,
    orgId: string,
    userId: string,
    now: number
  ) =>
    getCreateExternalAuthProviderWithTransactionItems(
      externalAuthSession,
      orgId,
      userId,
      now
    ),
  findOrCreateExternalAuthProviderIfNeeded = async (
    externalAuthSession: Api.Db.ExternalAuthSession,
    orgId: string,
    userId: string,
    now: number
  ): Promise<
    [
      Api.Db.ExternalAuthProvider | undefined,
      Api.Db.ObjectTransactionItems | undefined
    ]
  > => {
    let externalAuthProvider: Api.Db.ExternalAuthProvider | undefined,
      transactionItems: Api.Db.ObjectTransactionItems | undefined;
    if (externalAuthSession.externalAuthProviderId) {
      externalAuthProvider = await getDb<Api.Db.ExternalAuthProvider>({
        pkey: [orgId, "externalAuthProviders"].join("|"),
        skey: externalAuthSession.externalAuthProviderId,
      });
    }

    if (!externalAuthProvider) {
      const res = await createExternalAuthProviderIfNeeded(
        externalAuthSession,
        orgId,
        userId,
        now
      );
      if (res) {
        [externalAuthProvider, transactionItems] = res;
      }
    }

    return [externalAuthProvider, transactionItems];
  },
  getCreateExternalAuthProviderWithTransactionItems = (
    externalAuthSession: Api.Db.ExternalAuthSession,
    orgId: string,
    userId: string,
    now: number
  ):
    | [Api.Db.ExternalAuthProvider, Api.Db.ObjectTransactionItems]
    | undefined => {
    if (externalAuthSession.provider === "saml") {
      throw new TypeError(
        `Cannot create external auth provider automatically for SAML`
      );
    }
    if (
      externalAuthSession.authMethod == "oauth_hosted" &&
      (externalAuthSession.authType == "sign_up" ||
        (externalAuthSession.authType == "invite_users" &&
          externalAuthSession.inviteExternalAuthUsersType == "initial"))
    ) {
      const id = uuid(),
        externalAuthProvider: Api.Db.ExternalAuthProvider = {
          type: "externalAuthProvider",
          id,
          pkey: [orgId, "externalAuthProviders"].join("|"),
          skey: id,
          ...R.pick(
            ["authMethod", "provider", "providerSettings", "orgId"],
            externalAuthSession
          ),
          nickname: externalAuthSession.provider,
          orgId,
          verifiedByExternalAuthSessionId: externalAuthSession.id,
          verifiedByUserId: (userId || externalAuthSession.userId)!,
          createdAt: now,
          updatedAt: now,
        };

      return [
        externalAuthProvider,
        {
          softDeleteKeys: [R.pick(["pkey", "skey"], externalAuthSession)],
          puts: [
            externalAuthProvider,
            {
              ...externalAuthSession,
              externalAuthProviderId: id,
              orgId,
              userId,
              updatedAt: now,
              skey: getNonSamlExternalAuthSessionSkey({
                orgId,
                userId,
                provider: externalAuthSession.provider,
                authType: externalAuthSession.authType,
              }),
            } as Api.Db.ExternalAuthSession,
          ],
          updates: [],
        },
      ];
    }

    return undefined;
  };

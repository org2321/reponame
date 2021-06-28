import { query, getDb } from "../db";
import { Api } from "@core/types";
import { sha256 } from "@core/lib/crypto/utils";

export const getUserIdsWithEmail = async (email: string, orgId?: string) =>
    query<Api.Db.OrgUserIdByEmail>({ pkey: sha256(email), scope: orgId }),
  getUserIdByProviderUid = async (providerUid: string, orgId: string) =>
    getDb<Api.Db.OrgUserIdByProviderUid>({
      pkey: providerUid,
      skey: orgId,
    });

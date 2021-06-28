import { sha256 } from "@core/lib/crypto/utils";
import { getDb } from "../db";
import { Api } from "@core/types";

export const getAuthTokenKey = (
    orgId: string,
    userId: string,
    deviceId: string,
    token: string
  ): Api.Db.DbKey => ({
    pkey: [orgId, "tokens"].join("|"),
    skey: [userId, deviceId, token].join("|"),
  }),
  getAuthToken = async (
    orgId: string,
    userId: string,
    deviceId: string,
    token: string
  ) => {
    const authToken = await getDb<Api.Db.AuthToken>(
      getAuthTokenKey(orgId, userId, deviceId, token)
    );

    if (!authToken || sha256(token) !== sha256(authToken.token)) {
      return undefined;
    }

    return authToken;
  };

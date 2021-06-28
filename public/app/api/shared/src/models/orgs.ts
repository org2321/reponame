import { getDb, graphKey, query } from "../db";
import { Api } from "@core/types";

export const getOrgKey = (id: string): Api.Db.DbKey => graphKey(id, "org");

export const getOrg = async (id: string) => getDb<Api.Db.Org>(getOrgKey(id));

export const getOrgUser = async (orgId: string, userId: string) =>
  getDb<Api.Db.OrgUser>(graphKey(orgId, "orgUser", userId));

export const getAllOrgs = async () => {
  return query<Api.Db.Org>({
    scope: "g|org",
  });
};

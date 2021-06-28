import { getApiFullBaseUrl } from "../env";
import { Api, Auth } from "@core/types";
import { getDb, graphKey, query } from "../db";
import { apiErr } from "../handler";

// SCIM candidate users are not on the graph

export const scimCandidateDbKey = (params: {
  orgId: string;
  providerId: string;
  userCandidateId: string;
}): { pkey: string; skey: string } => {
  const { orgId, providerId, userCandidateId } = params;
  return {
    pkey: providerId,
    skey: ["scimUserCandidate", orgId, userCandidateId].join("|"),
  };
};

export const listActiveScimUserCandidates = (params: {
  orgId: string;
  providerId: string;
}): Promise<Api.Db.ScimUserCandidate[]> =>
  query<Api.Db.ScimUserCandidate>({
    pkey: params.providerId,
    scope: ["scimUserCandidate", params.orgId].join("|"),
    deleted: false,
  });

export const getScimEndpointBase = (id: string): string =>
  `${getApiFullBaseUrl()}/scim/${id}`;

export const mustGetScimProvider = async (
  providerId: string
): Promise<Api.Db.ScimProvisioningProvider> => {
  const pointer = await getDb<Api.Db.ScimProvisioningProviderPointer>({
    pkey: providerId,
    skey: "scimProvisioningProviderPointer",
  });
  if (!pointer) {
    throw await apiErr(
      undefined,
      `A SCIM provider was not found with the id ${providerId}`,
      404
    );
  }
  const provider = await getDb<Api.Db.ScimProvisioningProvider>(
    graphKey(pointer.orgId, "scimProvisioningProvider", providerId)
  );
  if (!provider) {
    throw await apiErr(
      undefined,
      "The provisioning provider lookup failed",
      500
    );
  }
  return provider;
};

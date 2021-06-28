import { apiAction, apiErr } from "../handler";
import { Api } from "@core/types";
import { authz } from "@core/lib/graph";
import { verifySignedLicense } from "../billing";

apiAction<
  Api.Action.RequestActions["UpdateLicense"],
  Api.Net.ApiResultTypes["UpdateLicense"]
>({
  type: Api.ActionType.UPDATE_LICENSE,
  graphAction: true,
  authenticated: true,
  graphAuthorizer: async (action, orgGraph, userGraph, auth) =>
    authz.hasOrgPermission(orgGraph, auth.user.id, "org_manage_billing"),
  graphHandler: async (
    { payload },
    orgGraph,
    auth,
    now,
    requestParams,
    transactionConn
  ) => {
    try {
      verifySignedLicense(auth.org.id, payload.signedLicense, now);
    } catch (err) {
      throw await apiErr(transactionConn, (err as Error).message, 401);
    }
    return {
      type: "graphHandlerResult",
      graph: {
        ...orgGraph,
        [auth.org.id]: { ...auth.org, signedLicense: payload.signedLicense },
      },
      logTargetIds: [],
    };
  },
});

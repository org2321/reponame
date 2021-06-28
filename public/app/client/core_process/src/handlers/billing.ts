import { clientAction } from "../handler";
import { Api } from "@core/types";
import { statusProducers } from "../lib/status";

clientAction<Api.Action.RequestActions["UpdateLicense"]>({
  type: "apiRequestAction",
  actionType: Api.ActionType.UPDATE_LICENSE,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...statusProducers("isUpdatingLicense", "updateLicenseError"),
});

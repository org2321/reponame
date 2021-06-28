import { Model } from "@core/types";

export const samlIdpHasMinimumSettings = (
  samlSettings: Model.SamlProviderSettings
): boolean => {
  return Boolean(
    samlSettings.identityProviderEntityId &&
      (samlSettings.identityProviderX509Certs?.length || 0) > 0 &&
      samlSettings.identityProviderLoginUrl
  );
};

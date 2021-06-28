import { Api, Model } from "@core/types";
import { dispatch } from "./core";
import { exit } from "./process";
import { logAndExitIfActionFailed } from "./args";
import chalk from "chalk";
// node-forge delegates to node's 'crypto' module, which wraps OpenSSL
import * as forge from "node-forge";
import { samlFingerprint } from "@core/lib/crypto/utils";

export const updatableIdpSettings: {
  friendly: string;
  prop: keyof Model.SamlIdpSettings;
}[] = [
  {
    friendly: "Entity ID (sometimes Issuer)",
    prop: "identityProviderEntityId",
  },
  {
    friendly: "SSO/Login URL",
    prop: "identityProviderLoginUrl",
  },
];

export const fetchExtendedSamlProvider = async (
  externalAuthProviderId: string
): Promise<{
  externalProvider: Model.ExternalAuthProvider;
  samlSettings: Model.SamlProviderSettings;
}> => {
  const res = await dispatch({
    type: Api.ActionType.GET_EXTERNAL_AUTH_PROVIDERS,
    payload: {
      provider: "saml",
    },
  });

  await logAndExitIfActionFailed(res, `Failed to get SAML info!`);
  const payload = (res.resultAction as any)?.payload as
    | Api.Net.ApiResultTypes["GetExternalAuthProviders"]
    | undefined;
  const externalProvider = payload?.providers?.find(
    (p: any) => p.id === externalAuthProviderId
  );
  if (!externalProvider || externalProvider.provider !== "saml") {
    return exit(1, "Failed fetching extended saml provider info");
  }
  const samlSettings = payload?.samlSettingsByProviderId?.[externalProvider.id];
  if (!samlSettings) {
    return exit(1, "Failed fetching extended saml settings info");
  }

  return { externalProvider, samlSettings };
};

export const updateProviderSettings = async (
  id: string,
  samlSettings?: Partial<
    Model.SamlIdpSettings & Model.SamlProviderEditableSettings
  >,
  nickname?: string
) => {
  const res = await dispatch({
    type: Api.ActionType.UPDATE_ORG_SAML_SETTINGS,
    payload: {
      id,
      nickname,
      samlSettings,
    },
  });

  await logAndExitIfActionFailed(res, `Failed to update SAML settings!`);

  return fetchExtendedSamlProvider(id);
};

export const getSafePemInfo = (pem: string, ix: number): string => {
  try {
    return printCertSummary(pem, true);
  } catch (err) {
    return `(Certificate at index ${ix}} could not be processed)`;
  }
};

// cli table doesn't work because the certs have \r\n which messes up the lines.
export const getSamlSettingsTable = (params: {
  samlSettings: Model.SamlProviderSettings;
  spOnly?: boolean;
  skipWholeCert?: boolean;
}): string => {
  const { samlSettings, spOnly, skipWholeCert } = params;
  const table: string[][] = [];

  let idpCert = chalk.red.bold("IdP cert has not been added yet.");
  if (samlSettings.identityProviderX509Certs?.length) {
    if (samlSettings.identityProviderX509Certs.length === 1) {
      idpCert =
        chalk.bold("1 certificate.\n\n") +
        printCertSummary(
          samlSettings.identityProviderX509Certs[0],
          skipWholeCert
        );
    } else {
      idpCert =
        chalk.bold(
          `${samlSettings.identityProviderX509Certs.length} certificates.\n\n`
        ) +
        samlSettings.identityProviderX509Certs
          .map((pem) => printCertSummary(pem, skipWholeCert))
          .join("\n\n");
    }
  }

  table.push(
    [
      chalk.blueBright.bold("(SP) Service Provider Entity ID (XML Metadata)"),
      samlSettings.serviceProviderEntityId,
    ],
    [
      chalk.blueBright.bold("(SP) Service Provider Assert/ACS/Callback URL"),
      samlSettings.serviceProviderAcsUrl,
    ],
    [
      chalk.blueBright.bold(
        "(SP) Service Provider Certificate (may not be required)"
      ),
      printCertSummary(samlSettings.serviceProviderX509Cert, skipWholeCert),
    ],
    [
      chalk.blueBright.bold("(SP) Name ID"),
      `Format:  ${samlSettings.serviceProviderNameIdFormat}\nName ID: ${
        !samlSettings.serviceProviderNameIdFormat.includes("email")
          ? "username or"
          : ""
      } email`,
    ],
    [
      chalk.blueBright.bold("(SP) Required Attribute Mapping"),
      `IdP email -> MUST be mapped to SP: "${samlSettings.serviceProviderAttributeMappings.emailAddress}"`,
    ],
    [
      chalk.blueBright.bold("(SP) Optional Attribute Mapping"),
      `IdP First Name -> may be mapped to SP: "${samlSettings.serviceProviderAttributeMappings.firstName}"\nIdP Last Name -> may be mapped to SP: "${samlSettings.serviceProviderAttributeMappings.lastName}"`,
    ],
    [chalk.blueBright.bold("Signature Algorithm"), "SHA256"]
  );
  if (!spOnly) {
    table.push(
      [
        chalk.blueBright.bold("(IdP) Identity Provider Known Service"),
        samlSettings.identityProviderKnownService || chalk.red.bold("Other"),
      ],
      [
        chalk.blueBright.bold("(IdP) Identity Provider Entity ID"),
        samlSettings.identityProviderEntityId ||
          chalk.red.bold("IdP entity ID has not been added yet."),
      ],
      [chalk.blueBright.bold("(IdP) Identity Provider Certificates"), idpCert],
      [
        chalk.blueBright.bold("(IdP) Identity Provider Login URL"),
        samlSettings.identityProviderLoginUrl ||
          chalk.red.bold("IdP login URL has not been added yet."),
      ]
    );
  }
  return (
    "\n" +
    table.map((l) => l.join("\n")).join("\n\n") +
    `\n\n----\nIdP = Identity Provider, SP = Service Provider (EnvKey)\n\n${chalk.bold.blueBright(
      "Scroll back for more info!"
    )}\n`
  );
};

export const printCertSummary = (
  pem: string,
  skipWholeCert?: boolean,
  rethrow?: boolean
): string => {
  try {
    const fingerSha1 = samlFingerprint(pem, "sha1");
    const fingerSha1Alt = fingerSha1.replace(/:/g, "").toUpperCase();
    const fingerSha2 = samlFingerprint(pem, "sha256");
    const fingerSha2Alt = fingerSha2.replace(/:/g, "").toUpperCase();
    // node-forge delegates to node's 'crypto' module, which wraps OpenSSL
    const c = forge.pki.certificateFromPem(pem);
    let infoText = `Expires: ${c.validity.notAfter.toISOString()}\nFingerprints:\n  SHA1:   ${fingerSha1}\n          ${fingerSha1Alt}\n  SHA256: ${fingerSha2}\n          ${fingerSha2Alt}`;
    if (skipWholeCert) {
      return infoText;
    }
    infoText += `\n\n${pem}`;
    return infoText;
  } catch (err) {
    const msg = chalk.red.bold(`Failed parsing certificate: ${err}`);
    if (rethrow) {
      console.error(msg);
      throw err;
    }
    return msg;
  }
};

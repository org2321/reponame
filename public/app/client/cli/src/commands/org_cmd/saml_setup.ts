import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import chalk from "chalk";
import { authz, graphTypes } from "@core/lib/graph";
import { Api, Auth } from "@core/types";
import { logAndExitIfActionFailed, normalizeFilePath } from "../../lib/args";
import {
  getSamlSettingsTable,
  fetchExtendedSamlProvider,
  printCertSummary,
  updatableIdpSettings,
  updateProviderSettings,
} from "../../lib/saml_helpers";
import fs from "fs";
import { getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["saml-setup"];
export const desc = "Initialize SAML SSO for this organization.";
export const builder = (yargs: Argv<BaseArgs>) => yargs;
export const handler = async (argv: BaseArgs): Promise<void> => {
  let updatedValue: string;
  const prompt = getPrompt();
  const { auth, state } = await initCore(argv, true);
  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }

  if (
    !authz.hasOrgPermission(
      state.graph,
      auth.userId,
      "org_manage_auth_settings"
    )
  ) {
    return exit(1, "Not allowed to manage SAML");
  }

  console.log(
    chalk.blueBright.bold("SAML Setup"),
    "\nEnvKey will generate SAML Service Provider (SP) config, which you can add to your existing Identity Provider (IdP)."
  );
  const { nickname } = await prompt<{
    nickname: string;
  }>({
    type: "input",
    name: "nickname",
    message: "Enter a name for the SAML provider",
    required: true,
  });

  const res = await dispatch({
    type: Api.ActionType.CREATE_ORG_SAML_PROVIDER,
    payload: {
      nickname,
    },
  });

  await logAndExitIfActionFailed(res, `Failed to generate the SAML provider!`);

  const newProviderId = graphTypes(res.state.graph).externalAuthProviders.find(
    (p) => p.nickname === nickname
  )!.id!;
  let { samlSettings } = await fetchExtendedSamlProvider(newProviderId);

  console.log(
    "The SAML provider",
    chalk.bold(nickname),
    "was created.",
    getSamlSettingsTable({
      samlSettings,
      spOnly: true,
    })
  );
  console.log(
    "The EnvKey Service Provider (SP) config above must be entered into your Identity Provider's (IdP). After that's done, gather the IdP's config and input it here. You can edit these IdP settings later, too."
  );

  const identityProviderKnownService = (
    await prompt<{
      identityProviderKnownService: string;
    }>({
      type: "select",
      required: true,
      name: "identityProviderKnownService",
      message: `Choose identity provider`,
      choices: Object.keys(Auth.SAML_KNOWN_IDENTITY_PROVIDERS).map((p) => ({
        name: p,
        message: p,
      })),
    })
  ).identityProviderKnownService as Auth.SamlKnownIdP;
  ({ samlSettings } = await updateProviderSettings(newProviderId, {
    identityProviderKnownService,
  }));

  // IdP settings input
  for (const { friendly, prop } of updatableIdpSettings) {
    ({ updatedValue } = await prompt<{ updatedValue: string }>({
      type: "input",
      required: true,
      name: "updatedValue",
      message: `IdP ${friendly}`,
    }));
    ({ samlSettings } = await updateProviderSettings(newProviderId, {
      [prop]: updatedValue,
    }));
    console.log("Saved", friendly, "as", chalk.bold(samlSettings[prop]));
  }

  // add idp cert
  let fileContents: string | undefined;
  while (!fileContents) {
    ({ updatedValue } = await prompt<{ updatedValue: string }>({
      type: "input",
      required: true,
      name: "updatedValue",
      message: `Enter the file path to the IdP certificate on your machine:`,
    }));
    try {
      // something's weird with fs promises and `pkg`
      const tempContents = fs.readFileSync(normalizeFilePath(updatedValue), {
        encoding: "utf8",
      });
      // provides a quick validation and user feedback
      console.log(printCertSummary(tempContents, true));
      fileContents = tempContents;
    } catch (err) {
      console.error("\n", err, "\n"); // loop
    }
  }
  ({ samlSettings } = await updateProviderSettings(newProviderId, {
    identityProviderX509Certs: (
      samlSettings.identityProviderX509Certs || []
    ).concat(fileContents),
  }));
  console.log(`IdP Certificate added successfully.`);

  console.log(
    `SAML setup is now complete.\nTo change any EnvKey Service Provider settings, use ${chalk.bold(
      "envkey org saml-update"
    )}`
  );

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

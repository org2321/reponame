import { exit } from "../../lib/process";
import { Argv } from "yargs";
import * as fs from "fs";
import { initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { graphTypes } from "@core/lib/graph";
import chalk from "chalk";
import { authz } from "@core/lib/graph";
import { normalizeFilePath } from "../../lib/args";
import {
  fetchExtendedSamlProvider,
  getSafePemInfo,
  printCertSummary,
  updatableIdpSettings,
  updateProviderSettings,
} from "../../lib/saml_helpers";
import { Auth } from "@core/types";
import Table from "cli-table3";
import { getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["saml-update"];
export const desc = "Update SAML SSO settings.";
export const builder = (yargs: Argv<BaseArgs>) => yargs;
export const handler = async (argv: BaseArgs): Promise<void> => {
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
  const providers = graphTypes(state.graph).externalAuthProviders.filter(
    (p) => p.provider === "saml"
  );
  if (!providers.length) {
    console.log(chalk.bold("There are no SAML providers."));
    return exit();
  }

  let id = providers[0].id;
  if (providers.length > 1) {
    ({ id } = await prompt<{ id: string }>({
      type: "select",
      name: "id",
      required: true,
      message: "Select a provider to view more info",
      choices: providers.map((p) => ({
        name: p.id,
        message: p.nickname,
      })),
    }));
  }

  let { externalProvider, samlSettings } = await fetchExtendedSamlProvider(id);

  console.log(
    "You will be promped to select which settings to update.\n\nNote: for SAML to function properly, all IdP settings must be entered.\n"
  );

  let confirm: boolean;
  let updatedValue: string;

  // update nickname
  ({ confirm } = await prompt<{ confirm: boolean }>({
    type: "confirm",
    name: "confirm",
    required: true,
    message: chalk.blueBright(
      `Current name:\n${externalProvider.nickname}\nWould you like to update the SAML name?`
    ),
  }));
  if (confirm) {
    ({ updatedValue } = await prompt<{ updatedValue: string }>({
      type: "input",
      required: true,
      name: "updatedValue",
      initial: externalProvider.nickname,
      message: `New value for nickname`,
    }));
    ({ externalProvider, samlSettings } = await updateProviderSettings(
      id,
      undefined,
      updatedValue
    ));
    console.log(
      "Successfully updated SAML name. New value is:",
      externalProvider.nickname
    );
  }

  // update known service
  ({ confirm } = await prompt<{ confirm: boolean }>({
    type: "confirm",
    name: "confirm",
    required: true,
    message: chalk.blueBright(
      `Current identity provider:\n${samlSettings.identityProviderKnownService}\nWould you like to update the provider?`
    ),
  }));
  if (confirm) {
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
    ({ samlSettings } = await updateProviderSettings(externalProvider.id, {
      identityProviderKnownService,
    }));
  }

  // update various other string props
  for (const { friendly, prop } of updatableIdpSettings) {
    ({ confirm } = await prompt<{ confirm: boolean }>({
      type: "confirm",
      name: "confirm",
      required: true,
      message: chalk.blueBright(
        `Current value for IdP ${friendly}:\n${chalk.bold(
          samlSettings[prop] ?? "<empty>"
        )}\nWould you like to update IdP ${chalk.bold(friendly)}?`
      ),
    }));
    if (!confirm) {
      continue;
    }

    ({ updatedValue } = await prompt<{ updatedValue: string }>({
      type: "input",
      required: true,
      name: "updatedValue",
      initial: samlSettings[prop],
      message: `New value for IdP ${chalk.bold(friendly)}`,
    }));
    ({ externalProvider, samlSettings } = await updateProviderSettings(id, {
      [prop]: updatedValue,
    }));
    console.log("Updated to", chalk.bold(samlSettings[prop]));
  }

  // add idp cert
  ({ confirm } = await prompt<{ confirm: boolean }>({
    type: "confirm",
    name: "confirm",
    required: true,
    message: `${
      samlSettings.identityProviderX509Certs?.length || 0
    } IdP certificate(s). Add${
      samlSettings.identityProviderX509Certs?.length || 0 > 1 ? " another" : ""
    } IdP certificate?`,
  }));
  if (confirm) {
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
        console.log(printCertSummary(tempContents, true, true));
        fileContents = tempContents;
      } catch (err) {
        console.error("\n", err, "\n"); // loop
      }
    }

    ({ externalProvider, samlSettings } = await updateProviderSettings(id, {
      identityProviderX509Certs: (
        samlSettings.identityProviderX509Certs || []
      ).concat(fileContents),
    }));
    console.log(
      `Certificate added successfully. There are now ${
        samlSettings.identityProviderX509Certs?.length || 0
      } IdP certificates.`
    );
  }

  // remove idp cert
  if (samlSettings.identityProviderX509Certs?.length) {
    ({ confirm } = await prompt<{ confirm: boolean }>({
      type: "confirm",
      name: "confirm",
      required: true,
      message: chalk.blueBright(
        `${
          samlSettings.identityProviderX509Certs?.length || 0
        } IdP certificate(s). Would you like to remove certificate(s)? ${chalk.redBright.bold(
          "(danger: may break user login)"
        )}`
      ),
    }));
    if (confirm) {
      ({ updatedValue } = await prompt<{ updatedValue: string }>({
        type: "select",
        required: true,
        name: "updatedValue",
        message: chalk.redBright("Select certificate to remove"),
        choices: samlSettings.identityProviderX509Certs.map((pem, ix) => ({
          name: pem,
          message: ix + 1 + ". " + getSafePemInfo(pem, ix),
        })),
      }));
      ({ externalProvider, samlSettings } = await updateProviderSettings(id, {
        identityProviderX509Certs: samlSettings.identityProviderX509Certs.filter(
          (c) => c !== updatedValue
        ),
      }));
      console.log(
        `Certificate removed successfully. There are now ${
          samlSettings.identityProviderX509Certs?.length || 0
        } IdP certificates.`
      );
    }
  }

  // Service Provider settings
  ({ confirm } = await prompt<{ confirm: boolean }>({
    type: "confirm",
    name: "confirm",
    required: true,
    message: chalk.blueBright(
      `(Advanced) Would you like to edit Service Provider (EnvKey SP) settings?`
    ),
  }));
  if (confirm) {
    // Name ID format
    ({ confirm } = await prompt<{ confirm: boolean }>({
      type: "confirm",
      name: "confirm",
      required: true,
      message: chalk.blueBright(
        `Current NameID format: ${samlSettings.serviceProviderNameIdFormat}.\nUpdate SP NameID format?`
      ),
    }));
    if (confirm) {
      ({ updatedValue } = await prompt<{
        updatedValue: string;
      }>({
        type: "select",
        required: true,
        name: "updatedValue",
        choices: Object.keys(Auth.SAML_NAME_ID_FORMATS),
        message: `New value for SP ${chalk.bold("NameID format")}`,
      }));
      ({ externalProvider, samlSettings } = await updateProviderSettings(id, {
        serviceProviderNameIdFormat:
          Auth.SAML_NAME_ID_FORMATS[updatedValue as "email" | "persistent"],
      }));
      console.log(
        "Updated to",
        chalk.bold(samlSettings.serviceProviderNameIdFormat)
      );
    }

    // saml callback attribute mappings
    let nextAttributes: Record<Auth.SamlMappable, string> | undefined;
    let k: Auth.SamlMappable;

    ({ confirm } = await prompt<{ confirm: boolean }>({
      type: "confirm",
      name: "confirm",
      required: true,
      message: chalk.blueBright(
        `Would you like to update user attribute mappings?`
      ),
    }));
    if (confirm) {
      nextAttributes = { ...samlSettings.serviceProviderAttributeMappings };

      // @ts-ignore issues with <const> seem impossible to resolve. it's the right type.
      for (k of Object.keys(Auth.SAML_ATTRIBUTE_DEFAULT_MAPPINGS)) {
        ({ updatedValue } = await prompt<{ updatedValue: string }>({
          type: "input",
          required: true,
          name: "updatedValue",
          initial: samlSettings.serviceProviderAttributeMappings[k] ?? "",
          message: chalk.blueBright(
            `Current mapping for ${k}: "${
              samlSettings.serviceProviderAttributeMappings[k]
            }". New value for SP ${chalk.bold(k)}:`
          ),
        }));
        nextAttributes[k] = updatedValue;
      }
    }

    ({ externalProvider, samlSettings } = await updateProviderSettings(id, {
      serviceProviderAttributeMappings: nextAttributes,
    }));
    const mappings = new Table({
      head: ["Attribute Description", "Service Provider Expected Value"],
    });
    for (const k of Object.keys(
      samlSettings.serviceProviderAttributeMappings
    )) {
      mappings.push([
        k,
        // @ts-ignore issues with <const> seem impossible to resolve. it's the right type.
        `"${samlSettings.serviceProviderAttributeMappings[k]}"`,
      ]);
    }
    console.log("Updated Attribute Mappings");
    console.log(mappings.toString());
  }

  console.log("SAML updates complete.");

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

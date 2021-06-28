import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { graphTypes } from "@core/lib/graph";
import chalk from "chalk";
import { authz } from "@core/lib/graph";
import {
  fetchExtendedSamlProvider,
  getSamlSettingsTable,
} from "../../lib/saml_helpers";
import { getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["saml"];
export const desc = "View SAML SSO providers.";
export const builder = (yargs: Argv<BaseArgs>) => yargs;
export const handler = async (argv: BaseArgs): Promise<void> => {
  const prompt = getPrompt();
  const { auth, state } = await initCore(argv, true);
  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }

  const providers = graphTypes(state.graph).externalAuthProviders.filter(
    (p) => p.provider === "saml"
  );
  if (!providers.length) {
    console.log(chalk.bold("There are no SAML providers."));
    return exit();
  }

  if (providers.length === 1) {
    console.log(`There is ${chalk.bold("1")} SAML provider.`);
  } else {
    console.log(`There are ${chalk.bold(providers.length)} SAML providers.`);
  }

  if (
    !authz.hasOrgPermission(
      state.graph,
      auth.userId,
      "org_manage_auth_settings"
    )
  ) {
    console.log("-", providers.map((p) => p.nickname).join("\n- "));
    console.log("You do not have permission to edit SAML settings.");
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

  const { samlSettings } = await fetchExtendedSamlProvider(id);

  const { printAll } = await prompt<{ printAll: boolean }>({
    type: "confirm",
    name: "printAll",
    initial: false,
    message: "Print entire certificate(s)?",
  });

  console.log(
    getSamlSettingsTable({
      samlSettings,
      skipWholeCert: !printAll,
    })
  );

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

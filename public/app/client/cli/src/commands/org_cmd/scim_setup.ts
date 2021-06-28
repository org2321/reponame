import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import chalk from "chalk";
import { authz } from "@core/lib/graph";
import { Auth, Client } from "@core/types";
import { logAndExitIfActionFailed } from "../../lib/args";
import { getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["scim-setup"];
export const desc =
  "Initialize automatic user invite provisioning through SCIM.";
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
    return exit(
      1,
      "Not allowed to manage automatic user provisioning settings"
    );
  }

  console.log(chalk.blueBright.bold("Automatic User Provisioning"));
  const { nickname } = await prompt<{
    nickname: string;
  }>({
    type: "input",
    name: "nickname",
    message: "Enter a name for the user provisioning provider",
    required: true,
  });
  let authScheme = (
    await prompt<{
      authScheme: string;
    }>({
      type: "select",
      name: "authScheme",
      choices: Object.keys(Auth.PROVISIONING_PROVIDER_AUTH_SCHEMES).map(
        (s) => ({
          name: s,
          message: Auth.PROVISIONING_PROVIDER_AUTH_FRIENDLY_NAMES[
            s as Auth.ProvisioningAuthScheme
          ]!,
        })
      ),
      message: "How will the provider authenticate to EnvKey?",
      required: true,
    })
  ).authScheme as Auth.ProvisioningAuthScheme;

  const res = await dispatch({
    type: Client.ActionType.CREATE_SCIM_PROVISIONING_PROVIDER,
    payload: {
      nickname,
      authScheme,
    },
  });

  await logAndExitIfActionFailed(
    res,
    `Failed to generate the provisioning provider!`
  );

  const { provisioningProviderConfig: creds } = res.state;

  console.log(
    `The SCIM provider`,
    chalk.bold(nickname),
    `was created.\nThe provider secret is:\n  ${chalk.bold(
      creds!.secret
    )}\nSave this secret now. It will not be shown again.\nThe base endpoint URL for this provider is: ${
      creds!.endpointBaseUrl
    }\nThese settings can be edited using ${chalk.bold("provisioning:update")}`
  );

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

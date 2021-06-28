import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { graphTypes } from "@core/lib/graph";
import chalk from "chalk";
import { authz } from "@core/lib/graph";
import { Api, Model } from "@core/types";
import { logAndExitIfActionFailed } from "../../lib/args";
import { getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["saml-delete"];
export const desc = "Completely clear SAML SSO settings.";
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
    console.error("No SAML providers");
    return exit();
  }

  const { id } = await prompt<{ id: string }>({
    type: "select",
    name: "id",
    required: true,
    message: "Select the SAML provider to be deleted",
    choices: providers.map((p) => ({
      name: p.id,
      message: p.nickname,
    })),
  });

  const provider = providers.find(
    (p) => p.id === id
  ) as Model.ExternalAuthProvider;

  const { confirm } = await prompt<{ confirm: boolean }>({
    type: "confirm",
    name: "confirm",
    message: `Delete ${chalk.bold(
      provider.nickname
    )} and all its config? This action cannot be reversed! All users with this login method will be converted to email login.`,
  });
  if (!confirm) {
    console.log("Aborted");
    return exit();
  }

  const res = await dispatch({
    type: Api.ActionType.DELETE_EXTERNAL_AUTH_PROVIDER,
    payload: {
      id,
    },
  });

  await logAndExitIfActionFailed(res, `Failed to generate the SAML provider!`);

  console.log(
    `${chalk.bold(
      provider.nickname
    )} and all its config was successfully deleted.`
  );

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import chalk from "chalk";
import { authz, graphTypes } from "@core/lib/graph";
import { Api, Auth, Model } from "@core/types";
import { logAndExitIfActionFailed } from "../../lib/args";
import { secureRandomAlphanumeric } from "@core/lib/crypto";
import { getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["scim-update"];
export const desc = "Modify settings for an existing SCIM provider.";
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

  const providers = graphTypes(state.graph).scimProvisioningProviders;
  if (!providers.length) {
    console.error("There are no SCIM providers");
    return exit();
  }

  const { id } = await prompt<{ id: string }>({
    type: "select",
    name: "id",
    required: true,
    message: "Select the SCIM provider to be modified",
    choices: providers.map((p) => ({
      name: p.id,
      message: `${p.nickname}`,
    })),
  });

  let provisioningProvider = state.graph[id]! as Model.ScimProvisioningProvider;

  // nickname
  let { confirm } = await prompt<{ confirm: boolean }>({
    type: "confirm",
    name: "confirm",
    message: chalk.blueBright.bold(
      `Current nickname: ${provisioningProvider.nickname}.\nEdit nickname?`
    ),
  });
  if (confirm) {
    const { nickname } = await prompt<{
      nickname: string;
    }>({
      type: "input",
      name: "nickname",
      message: "Enter a name for the user provisioning provider",
      required: true,
    });
    const res = await dispatch({
      type: Api.ActionType.UPDATE_SCIM_PROVISIONING_PROVIDER,
      payload: {
        id,
        authScheme: provisioningProvider.authScheme,
        nickname, // change
      },
    });
    await logAndExitIfActionFailed(res, "Failed updating nickname!");
    provisioningProvider = res.state.graph[
      id
    ]! as Model.ScimProvisioningProvider;
  }

  // auth scheme
  ({ confirm } = await prompt<{ confirm: boolean }>({
    type: "confirm",
    name: "confirm",
    message: chalk.blueBright.bold(
      `Current provider auth scheme: ${
        Auth.PROVISIONING_PROVIDER_AUTH_FRIENDLY_NAMES[
          provisioningProvider.authScheme
        ]
      }\nEdit provider auth method?`
    ),
  }));
  if (confirm) {
    const authScheme = (
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
      type: Api.ActionType.UPDATE_SCIM_PROVISIONING_PROVIDER,
      payload: {
        id,
        nickname: provisioningProvider.nickname,
        authScheme,
      },
    });
    await logAndExitIfActionFailed(res, "Failed updating provider protocol!");
    provisioningProvider = res.state.graph[
      id
    ]! as Model.ScimProvisioningProvider;
  }
  // roll secret
  ({ confirm } = await prompt<{ confirm: boolean }>({
    type: "confirm",
    name: "confirm",
    message: chalk.blueBright.bold(`Change provider auth secret?`),
  }));
  if (confirm) {
    const { choice } = await prompt<{ choice: string }>({
      type: "select",
      name: "choice",
      required: true,
      message: chalk.bold("Secret"),
      choices: [
        {
          name: "1",
          message: "Let EnvKey generate the secret for me (recommended)",
        },
        { name: "2", message: "I want to enter the secret myself" },
      ],
    });
    const secret =
      choice === "2"
        ? (
            await prompt<{
              secret: string;
            }>({
              type: "input",
              name: "secret",
              message: "Enter the new provider auth secret",
              required: true,
              validate: async (value: string) => {
                if (value.length < 8) {
                  console.error("The auth secret is too short\n\n");
                  return false;
                }
                return true;
              },
            })
          ).secret
        : ["ekb", secureRandomAlphanumeric(25)].join("_");

    const res = await dispatch({
      type: Api.ActionType.UPDATE_SCIM_PROVISIONING_PROVIDER,
      payload: {
        id,
        nickname: provisioningProvider.nickname,
        authScheme: provisioningProvider.authScheme,
        secret,
      },
    });
    await logAndExitIfActionFailed(res, "Failed updating provider protocol!");
    provisioningProvider = res.state.graph[
      id
    ]! as Model.ScimProvisioningProvider;

    console.log(
      `The new auth secret for ${chalk.bold(
        provisioningProvider.nickname
      )} is:\n `,
      chalk.bold(secret),
      "\nStore it in a safe place, it will not be shown again."
    );
  }

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

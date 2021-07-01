import { promptDeviceSecurityOptions } from "../lib/crypto";
import { spinnerWithText, spinner, stopSpinner } from "../lib/spinner";
import { addCommand } from "../cmd";
import { exit } from "../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore, getState, refreshState } from "../lib/core";
import { BaseArgs } from "../types";
import { wait } from "@core/lib/utils/wait";
import { Client, Api } from "@core/types";
import { getPrompt } from "../lib/console_io";
import chalk from "chalk";
import { logAndExitIfActionFailed } from "../lib/args";
import {
  regions,
  primaryRegionSettings,
  regionLabels,
} from "@infra/stack-constants";
import { getDefaultOrgSettings } from "@core/lib/client/defaults";
import { LOCAL_DEV_SELF_HOSTED_HOST } from "../../../shared/src/env";

type BasicPromptOptions = {
  orgName: string;
  firstName: string;
  lastName: string;
  deviceName: string;
};

type SelfHostedPromptOptions = {
  profile: string;
  primaryRegion: string;
  domain: string;
  customDomainBooleanString: string;
  verifiedSenderEmail: string;
  notifySmsWhenDone?: string;
};

const defaultOrgSettings = getDefaultOrgSettings();

const CHOICE_LOCAL_SELF_HOSTED = "local-self-hosted";
const CHOICE_CLOUD = "cloud";
const CHOICE_DEV_OVERRIDE = "local-dev-override-host";

addCommand((yargs: Argv<BaseArgs>) =>
  yargs.command(
    ["register", "sign-up"],
    "Creates a new organization and account. Choose between EnvKey Cloud or Self-Hosted.",
    (yargs) => yargs,
    async (argv) => {
      const prompt = getPrompt();
      let { state } = await initCore(argv, false);

      console.log(
        chalk.bold("Creating a new organization is easy."),
        "Just follow the prompts below.\n"
      );

      let { hostChoice } = await prompt<{
        hostChoice:
          | Api.Net.ApiParamTypes["Register"]["hostType"]
          | typeof CHOICE_LOCAL_SELF_HOSTED
          | typeof CHOICE_DEV_OVERRIDE;
      }>({
        type: "select",
        name: "hostChoice",
        message:
          "Do you want to use EnvKey Cloud or deploy EnvKey Self-Hosted on AWS?",
        required: true,
        choices: [
          {
            name: CHOICE_CLOUD,
            message: "EnvKey Cloud",
          },
          {
            name: "self-hosted",
            message: "EnvKey Self-Hosted on AWS",
          },
          ...(process.env.NODE_ENV == "development"
            ? [
                {
                  name: CHOICE_LOCAL_SELF_HOSTED,
                  message: "Local EnvKey Self-Hosted (Dev Only)",
                },
                {
                  name: CHOICE_DEV_OVERRIDE,
                  message: "Custom Host Override (Dev Only)",
                },
              ]
            : []),
        ],
      });

      let email: string;
      let orgName: string;
      let res: Client.DispatchResult;
      let overrideHostType: "self-hosted" | "cloud" | undefined;

      if (
        [CHOICE_CLOUD, CHOICE_LOCAL_SELF_HOSTED, CHOICE_DEV_OVERRIDE].includes(
          hostChoice
        )
      ) {
        let maybeHostUrlOverride: string | undefined = undefined;

        if (hostChoice == CHOICE_LOCAL_SELF_HOSTED) {
          maybeHostUrlOverride = LOCAL_DEV_SELF_HOSTED_HOST;
        } else if (hostChoice === CHOICE_DEV_OVERRIDE) {
          maybeHostUrlOverride = (
            await prompt<{ override: string }>({
              type: "input",
              name: "override",
              required: true,
              message: "Enter override hostUrl, dev:",
            })
          ).override;
          overrideHostType = (
            await prompt<{ hostType: "self-hosted" | "cloud" }>({
              type: "select",
              required: true,
              name: "hostType",
              choices: ["self-hosted", "cloud"],
              message: "Ender hostType, dev",
            })
          ).hostType;
        }

        ({ email } = await prompt<{ email: string }>({
          type: "input",
          name: "email",
          required: true,
          message: "Your email:",
        }));

        const verifyRes = await dispatch(
          {
            type: Api.ActionType.CREATE_EMAIL_VERIFICATION,
            payload: {
              email,
              authType: "sign_up",
            },
          },
          undefined,
          maybeHostUrlOverride
        );
        await logAndExitIfActionFailed(
          verifyRes,
          "There was a problem connecting to EnvKey Cloud. Please check your connection and try again."
        );

        let { emailVerificationToken } = await prompt<{
          emailVerificationToken: string;
        }>({
          type: "password",
          name: "emailVerificationToken",
          required: true,

          message: `An Sign Up Token was just sent to ${email}. Please paste it here:`,
        });

        let checkValidRes = await dispatch(
          {
            type: Api.ActionType.CHECK_EMAIL_TOKEN_VALID,
            payload: { email, token: emailVerificationToken },
          },
          undefined,
          maybeHostUrlOverride
        );

        // TODO: add link to issues support here
        while (!checkValidRes.success) {
          ({ emailVerificationToken } = await prompt<{
            emailVerificationToken: string;
          }>({
            type: "password",
            name: "emailVerificationToken",
            message:
              "Sign Up token invalid. Please ensure it was copied correctly and try again:",
          }));

          checkValidRes = await dispatch(
            {
              type: Api.ActionType.CHECK_EMAIL_TOKEN_VALID,
              payload: { email, token: emailVerificationToken },
            },
            undefined,
            maybeHostUrlOverride
          );
        }

        console.log(
          chalk.bold("\nGreat! Your Sign Up Token is valid."),
          "Now just a bit more info is needed to finish creating your organization.\n"
        );

        const basicOpts = await promptBasicOptions(state);
        orgName = basicOpts.orgName;
        const { firstName, lastName, deviceName } = basicOpts;

        spinnerWithText(
          "Creating organization..." +
            (maybeHostUrlOverride ? " " + maybeHostUrlOverride : "")
        );

        if (
          hostChoice === CHOICE_CLOUD ||
          (hostChoice === CHOICE_DEV_OVERRIDE && overrideHostType === "cloud")
        ) {
          res = await dispatch(
            {
              type: Client.ActionType.REGISTER,
              payload: {
                hostType: "cloud",
                org: {
                  name: orgName,
                  settings: defaultOrgSettings,
                },
                user: {
                  email,
                  firstName,
                  lastName,
                },
                device: { name: deviceName },
                provider: <const>"email",
                emailVerificationToken,
              },
            },
            undefined,
            maybeHostUrlOverride
          );
        } else {
          // local-self-hosted
          res = await dispatch(
            {
              type: Client.ActionType.REGISTER,
              payload: {
                hostType: "self-hosted",
                org: {
                  name: orgName,
                  settings: defaultOrgSettings,
                },
                user: {
                  email,
                  firstName,
                  lastName,
                },
                device: { name: deviceName },
                provider: <const>"email",
                devOnlyLocalSelfHosted: true,
                emailVerificationToken,
                profile: "",
                domain: "",
                primaryRegion: "",
                verifiedSenderEmail: "",
                customDomain: false,
              },
            },
            undefined,
            maybeHostUrlOverride
          );
        }
      } else {
        console.log(
          `\nInstalling EnvKey Self-Hosted is ${chalk.bold(
            "easy"
          )}. It usually takes less than an hour, and most of that is waiting for resources to spin up.`
        );

        console.log(
          `\nFirst, you need to get an AWS account ready for deployment. For security and simplicity, ${chalk.bold(
            "we strongly recommend creating a new account just for EnvKey"
          )}, but you can also use an existing account if you're the rebellious type.`
        );

        // TODO: add this page to docs
        console.log(
          `\nFrom there, follow the steps at ${chalk.bold(
            "https://docs.envkey.com/self-hosted"
          )}`
        );

        console.log(
          `\nWhen you're done setting up your AWS account, come on back here to finish up.\n`
        );

        const { confirm } = await prompt<{ confirm: boolean }>({
          type: "confirm",
          name: "confirm",
          message: "Is your AWS account ready to go?",
        });

        if (!confirm) {
          return exit(1, chalk.red("Aborted."));
        }

        console.log(
          `\nGreat! Now, you just need to supply some info in order to kick off the installation, which usually finishes in about 20 minutes. You'll get a link to track progress, and then an email (and, optionally, an SMS) when it's complete.\n\n${chalk.bold(
            "**No data is sent anywhere other than your AWS account.**"
          )}\n`
        );

        ({ email } = await prompt<{ email: string }>({
          type: "input",
          name: "email",
          required: true,
          message: "Your email:",
        }));

        const basicOpts = await promptBasicOptions(state);
        orgName = basicOpts.orgName;
        const { firstName, lastName, deviceName } = basicOpts;

        const {
          profile,
          primaryRegion,
          customDomainBooleanString,
          domain,
          verifiedSenderEmail,
          notifySmsWhenDone,
        } = await prompt<SelfHostedPromptOptions>([
          {
            type: "input",
            name: "profile",
            required: true,
            message: "AWS profile name (in `~/.aws/credentials` file):",
            initial: "envkey-host",
          },
          {
            type: "select",
            name: "primaryRegion",
            required: true,
            message: "AWS Regions:",
            choices: regions.map((r) => {
              const failoverRegion = primaryRegionSettings[r].failoverRegion;
              return {
                name: r,
                message: `Primary: ${r} (${regionLabels[r]}) / Failover: ${failoverRegion} (${regionLabels[failoverRegion]})`,
              };
            }),
          },
          {
            type: "select",
            name: "customDomainBooleanString",
            message: "Domain type:",
            required: true,
            choices: [
              {
                name: "false",
                message:
                  "Auto-managed domain purchased through Route53 (EnvKey handles DNS records automatically)",
              },
              {
                name: "true",
                message:
                  "Use an existing domain (and set your own DNS records)",
              },
            ],
          },
          {
            type: "input",
            name: "domain",
            required: true,
            message: "Domain (example: `org-secrets.com`):",
          },
          {
            type: "input",
            name: "verifiedSenderEmail",
            required: true,
            // TODO: add this section to docs
            message:
              "Verified sender email (FROM address for EnvKey-related emails, verified with Amazon SES):",
          },
          {
            type: "input",
            name: "notifySmsWhenDone",
            message:
              "Phone number to send an SMS notifcation to when installation is complete (optional):",
          },
        ]);

        res = await dispatch({
          type: Client.ActionType.REGISTER,
          payload: {
            hostType: "self-hosted",
            org: {
              name: orgName,
              settings: defaultOrgSettings,
            },
            user: {
              email,
              firstName,
              lastName,
            },
            device: { name: deviceName },
            provider: <const>"email",
            profile,
            primaryRegion,
            customDomain: customDomainBooleanString === "true",
            domain,
            verifiedSenderEmail,
            notifySmsWhenDone,
          },
        });
      }

      state = res.state;
      const { passphrase, lockoutMs } = await maybePromptDeviceSecurityOptions(
        state
      );

      // need to manually exit process since yargs doesn't properly wait for async handlers
      if (!res.success) {
        stopSpinner();
        // TODO: add link to issues support here
        return exit(
          1,
          `There was a problem creating '${orgName}'. Error below:\n${JSON.stringify(
            (res.resultAction as any).payload,
            null,
            2
          )}`
        );
      }

      if (passphrase) {
        await dispatch({
          type: Client.ActionType.SET_DEVICE_PASSPHRASE,
          payload: { passphrase },
        });
      }

      if (lockoutMs) {
        await dispatch({
          type: Client.ActionType.SET_DEVICE_LOCKOUT,
          payload: { lockoutMs },
        });
      }

      state = getState();

      if (hostChoice != "self-hosted") {
        console.log(
          `\n${chalk.bold(
            orgName
          )} created! You might now want to create an app with ${chalk.bold(
            "envkey apps create"
          )} or start inviting your team with ${chalk.bold(
            "envkey users invite"
          )}\n`
        );
        return exit();
      } // end cloud signup

      // for self-hosted, we re-fetch the state in a loop and report status updates until deployment has started successfully or there's an error
      console.log("");
      spinner();

      let deployStatus = state.deploySelfHostedStatus;
      while (state.isDeployingSelfHosted) {
        await wait(500);
        state = await refreshState();
        if (state.deploySelfHostedStatus != deployStatus) {
          deployStatus = state.deploySelfHostedStatus;
          if (deployStatus) {
            stopSpinner();
            console.log(deployStatus);
            spinner();
          }
        }
      }
      stopSpinner();
      if (state.deploySelfHostedError) {
        return exit(
          1,
          `There was a problem starting the deployment of Self-Hosted EnvKey:\n${JSON.stringify(
            state.deploySelfHostedError,
            null,
            2
          )}`
        );
      }

      const pending =
        state.pendingSelfHostedDeployments[
          state.pendingSelfHostedDeployments.length - 1
        ];
      console.log(
        `\n${chalk.bold(
          "Self-Hosted EnvKey is now installing."
        )} You can track progress here:\n\n${chalk.bold(
          pending.codebuildLink
        )}\n\nYou'll get an email with further instructions when installation is complete.\n`
      );

      exit();
    }
  )
);

const promptBasicOptions = (state: Client.State) => {
  const prompt = getPrompt();
  return prompt<BasicPromptOptions>([
    {
      type: "input",
      name: "orgName",
      required: true,
      message: "Organization name:",
    },
    {
      type: "input",
      name: "firstName",
      required: true,
      message: "Your first name:",
    },
    {
      type: "input",
      name: "lastName",
      required: true,
      message: "Your last name:",
    },
    {
      type: "input",
      name: "deviceName",
      required: true,
      initial: state.defaultDeviceName,
      message: "Name of this device:",
    },
  ]);
};
const maybePromptDeviceSecurityOptions = async (state: Client.State) => {
  let passphrase: string | undefined, lockoutMs: number | undefined;
  if (
    !state.requiresPassphrase &&
    Object.keys(state.orgUserAccounts).length == 0
  ) {
    ({ passphrase, lockoutMs } = await promptDeviceSecurityOptions({
      shouldPromptPassphrase: true,
      passphraseRequired: false,
      shouldPromptLockout: true,
      lockoutRequired: false,
      maxLockout: undefined,
    }));
  }
  return { passphrase, lockoutMs };
};

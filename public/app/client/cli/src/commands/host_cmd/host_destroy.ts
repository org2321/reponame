import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { BaseArgs } from "../../types";
import { destroyHost } from "@infra/destroy-host";
import { primaryRegionSettings, regions, Region } from "@infra/stack-constants";
import { listDeploymentTags } from "@infra/aws-helpers";
import { dispatch, initCore } from "../../lib/core";
import { Client } from "@core/types";
import chalk from "chalk";
import { getPrompt } from "../../lib/console_io";

export const command = "destroy [primary-region]";
export const desc =
  "Completely removes EnvKey host from AWS. This action is permanent and cannot be undone.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("primary-region", {
      type: "string",
      demandOption: true,
      choices: regions,
    })
    .option("destroy", {
      type: "boolean",
      description:
        "Delete the deployment - without this option, will do a dry-run",
    })
    .option("deployment-tag", {
      type: "string",
      describe: "Manually pass a deployment tag",
    })
    .option("profile", {
      type: "string",
      default: "envkey-host",
      description: "AWS credentials profile name",
    })
    .option("clear-pending-account", {
      type: "boolean",
      description:
        "(Advanced) clear a local pending self-hosted account without deprovisioning the entire service",
    });
export const handler = async (
  argv: BaseArgs & {
    "primary-region"?: string;
    destroy?: boolean;
    "deployment-tag"?: string;
    profile?: string;
    "clear-pending-account"?: boolean;
  }
): Promise<void> => {
  const prompt = getPrompt();
  const { state } = await initCore(argv, false);

  const clearPendingOnly = argv["clear-pending-account"];
  const dryRun = !argv["destroy"];
  let deploymentTag = argv["deployment-tag"];

  console.log("Using AWS profile", argv["profile"]);

  const primaryRegion = (argv["primary-region"] ??
    (
      await prompt<{ primaryRegion: string }>({
        type: "select",
        name: "primaryRegion",
        message: "Select region",
        choices: regions,
      })
    ).primaryRegion) as Region;

  if (!deploymentTag) {
    const tags = await listDeploymentTags({
      profile: argv["profile"],
      primaryRegion,
    });
    if (!tags.length) {
      console.log(
        "No EnvKey hosts were found for your AWS profile - specify one manually with --deployment-tag."
      );
      return exit(0);
    }
    if (tags.length === 1) {
      deploymentTag = tags[0];
      console.log("Using deployment tag", deploymentTag);
    } else {
      ({ deploymentTag } = await prompt<{ deploymentTag: string }>({
        type: "select",
        name: "deploymentTag",
        message: "Select a deployment:",
        initial: 0,
        choices: tags,
      }));
    }
  }

  if (clearPendingOnly) {
    const { confirm } = await prompt<{ confirm: boolean }>({
      type: "confirm",
      name: "confirm",
      message: chalk.bold(
        "Really remove pending account verifications for this deployment? This is not a common option"
      ),
    });
    if (!confirm) {
      return exit();
    }
    await cleanupPending(state, deploymentTag);
    return exit();
  }

  if (!dryRun) {
    const { confirm } = await prompt<{ confirm: boolean }>({
      type: "confirm",
      name: "confirm",
      message: chalk.bold(
        `Really destroy the EnvKey deployment (${deploymentTag})? This cannot be undone!`
      ),
    });

    if (!confirm) {
      return exit();
    }
  }

  // note: spinner messes up confirmation because it overwrites stdout

  try {
    const failed = await destroyHost({
      dryRun,
      deploymentTag,
      profile: argv["profile"],
      primaryRegion,
      failoverRegion: primaryRegionSettings[primaryRegion].failoverRegion,
    });
    if (failed) {
      console.log("Some resources were not cleaned up.");
    }
  } catch (err) {
    return exit(1, err);
  }

  console.log("");

  if (dryRun) {
    console.log(
      "To destroy all the resources above, run this command again with --destroy"
    );
  } else {
    // clean up any local accounts for this host
    const accounts = Object.values(
      state.orgUserAccounts
    ) as Client.ClientUserAuth[];
    for (let account of accounts) {
      if (account.deploymentTag == deploymentTag) {
        await dispatch(
          {
            type: Client.ActionType.FORGET_DEVICE,
            payload: { accountId: account.userId },
          },
          account.userId
        );
      }
    }

    await cleanupPending(state, deploymentTag);

    console.log(
      "The EnvKey host deletion has run to the end. Check the logs above for anything which failed to delete. It may take a little while for certain resources to be released."
    );
    console.log("Any RDS snapshots will need to be removed manually.");
  }
  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

const cleanupPending = async (state: Client.State, deploymentTag: string) => {
  // clean up any pending deployments for this host
  const pendingAccounts = state.pendingSelfHostedDeployments;
  for (let pending of pendingAccounts) {
    if (pending.deploymentTag == deploymentTag) {
      await dispatch({
        type: Client.ActionType.CLEAR_PENDING_SELF_HOSTED_DEPLOYMENT,
        payload: { deploymentTag },
      });
      console.log("Removed pending account", pending.uid);
    }
  }
};

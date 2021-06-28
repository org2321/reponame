import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { BaseArgs } from "../../types";
import { getAwsAccountId, getSesAzsForRegion } from "@infra/aws-helpers";
import chalk from "chalk";
import { primaryRegionSettings, regions } from "@infra/stack-constants";
import {autoModeOut} from "../../lib/console_io";

export const command = "availability-zones";
export const desc =
  "List all the AWS availability zones allowed for self-hosted deployments.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs.option("profile", {
    type: "string",
    describe: "AWS local profile name in ~/.aws/credentials",
    default: "envkey-host",
  });
export const handler = async (argv: BaseArgs & { profile?: string }): Promise<void> => {
  const profile = argv.profile;

  try {
    const awsAccountId = await getAwsAccountId(profile);
    console.log(
      `Verified profile ${profile} with AWS account ${awsAccountId} \n`
    );

    console.log(
      "When deploying a self-hosted EnvKey, the primary regions below are valid options:"
    );

    for (const region of regions) {
      console.log("\nPrimary:", chalk.bold.blueBright(region));
      console.log(
        "   Uses availability zones: ",
        chalk.blueBright((await getSesAzsForRegion(profile, region)).join("  "))
      );
      console.log(
        "   Uses failover region:    ",
        chalk.blueBright(primaryRegionSettings[region].failoverRegion)
      );
    }
  } catch (err) {
    return exit(1, err);
  }

  autoModeOut({ regions });

  return exit(0);
};

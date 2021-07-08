import { SharedIniFileCredentials } from "aws-sdk";
import IAM from "aws-sdk/clients/iam";
import CF from "aws-sdk/clients/cloudformation";
import CodeBuild from "aws-sdk/clients/codebuild";
import Secrets from "aws-sdk/clients/secretsmanager";
import S3 from "aws-sdk/clients/s3";
import SNS from "aws-sdk/clients/sns";
import {
  dangerouslyDeleteS3BucketsWithConfirm,
  dangerouslyDeleteSecretsWithConfirm,
  deleteDeployTag,
  getAwsAccountId,
  listCodebuildProjects,
} from "./aws-helpers";
import {
  CfStack,
  getSnsAlertTopicArn,
} from "./stack-constants";
import * as R from "ramda";

export const destroyHost = async (params: {
  deploymentTag: string;
  primaryRegion: string;
  failoverRegion: string;
  dryRun?: boolean;
  profile?: string;
}): Promise<boolean> => {
  const {
    dryRun,
    deploymentTag,
    profile,
    primaryRegion,
    failoverRegion,
  } = params;
  const credentials = profile
    ? new SharedIniFileCredentials({
        profile,
      })
    : undefined;
  const s3 = new S3({ region: primaryRegion, credentials });
  const s3Secondary = new S3({ region: failoverRegion, credentials });
  const cf = new CF({
    region: primaryRegion,
    credentials,
  });
  const cfSecondary = new CF({
    region: failoverRegion,
    credentials,
  });
  const codeBuild = new CodeBuild({ region: primaryRegion, credentials });
  const secretsManager = new Secrets({ region: primaryRegion, credentials });
  const sns = new SNS({ region: primaryRegion, credentials });
  const iam = new IAM({ region: primaryRegion, credentials });

  let failed = false;

  if (dryRun) {
    console.log("DRY RUN - no resources will be deleted.");
  }

  const awsAccountId = await getAwsAccountId(profile);

  // destroy all CloudFormation stacks
  for (const stackBaseName of R.reverse(Object.values(CfStack))) {
    const cfClient = stackBaseName.includes("_SECONDARY_") ? cfSecondary : cf;
    const stackName = [stackBaseName, deploymentTag].join("-");

    try {
      await cfClient
        .describeStacks({ StackName: stackName })
        .promise()
        .catch(() => ({ Stacks: undefined }))
        .then(({ Stacks }) => {
          if (Stacks && Stacks[0]?.StackId) {
            if (dryRun) {
              console.log("Stack:\n ", stackName, "\n ", Stacks[0].StackId);
              return;
            }
            console.log("Stack:\n  Destroying", stackName, Stacks[0].StackId);
            return cfClient
              .deleteStack({ StackName: Stacks[0].StackId })
              .promise();
          }
        });
    } catch (err) {
      console.error(err.message);
      failed = true;
    }
  }

  // destroy codebuild projects by deploymentTag
  const tagProjects = await listCodebuildProjects(codeBuild, deploymentTag);
  console.log("Build projects to delete:", tagProjects.length);
  for (const name of tagProjects) {
    if (dryRun) {
      console.log("  Build project:", name);
      continue;
    }
    console.log("  Destroying build project:", name);
    try {
      await codeBuild
        .deleteProject({
          name,
        })
        .promise();
    } catch (err) {
      console.error(err.message);
      failed = true;
    }
  }

  // delete sns topics
  try {
    const topicArn = getSnsAlertTopicArn(
      deploymentTag,
      primaryRegion,
      awsAccountId
    );
    if (dryRun) {
      console.log("SNS topic:\n ", topicArn);
    } else {
      console.log("Deleting SNS topic:\n ", topicArn);
      await sns.deleteTopic({ TopicArn: topicArn }).promise();
    }
  } catch (err) {
    console.error(err.message);
    failed = true;
  }

  // delete IAM roles
  const roleNames: string[] = [];
  let marker: string | undefined;
  while (true) {
    const { Roles: roles, Marker: m } = await iam
      .listRoles(marker ? { MaxItems: 100, Marker: marker } : { MaxItems: 100 })
      .promise();
    marker = m;
    const filteredRoles = roles.filter((role) =>
      role.RoleName.includes(deploymentTag)
    );
    roleNames.push(...filteredRoles.map((role) => role.RoleName));
    if (!roles.length || !marker) {
      break;
    }
  }
  console.log("IAM roles found:", roleNames.length);
  for (const roleName of roleNames) {
    if (dryRun) {
      console.log("  IAM role:", roleName);
      continue;
    }
    console.log("  Deleting iam role", roleName);
    try {
      await iam.deleteRole({ RoleName: roleName });
    } catch (err) {
      console.error(err.message);
      failed = true;
    }
  }

  // destroy all buckets by deploymentTag
  try {
    // primary
    console.log("Primary buckets...");
    await dangerouslyDeleteS3BucketsWithConfirm({
      s3,
      all: true,
      force: true,
      filterInclude: deploymentTag,
      dryRun,
    });
  } catch (err) {
    console.error(err.message);
    failed = true;
  }
  try {
    // secondary
    console.log("Secondary buckets...");
    await dangerouslyDeleteS3BucketsWithConfirm({
      s3: s3Secondary,
      all: true,
      force: true,
      filterInclude: deploymentTag,
      dryRun,
    });
  } catch (err) {
    console.error(err.message);
    failed = true;
  }

  console.log("");
  // delete all secrets by deploymentTag
  try {
    await dangerouslyDeleteSecretsWithConfirm({
      secretsManager,
      all: true,
      force: true,
      filterInclude: deploymentTag,
      dryRun,
    });
  } catch (err) {
    console.error(err.message);
    failed = true;
  }

  if (!dryRun && !failed) {
    try {
      await deleteDeployTag({ profile, primaryRegion, deploymentTag });
    } catch (err) {
      console.log(err.message);
      failed = true;
    }
  }

  return failed;
};

import { Infra } from "@core/types";

export const API_ZIP_FILE =
  process.env.ENVKEY_OVERRIDE_API_ZIP_FILE || "api.zip"; // Will be set in CLI or CodeBuild, but not on API.

// our release artifact buckets will always be in that region, at least for now
export const RELEASE_ASSET_REGION = "us-east-1";
// the buckets can be overriden for cloud
export const ENVKEY_RELEASES_BUCKET =
  process.env.ENVKEY_RELEASES_BUCKET || "envkey-releases";
// the following creds can be overriden for cloud or development, when pulling updates from a private bucket
export const envkeyReleasesS3Creds: Infra.OptionalAwsCreds = process.env
  .ENVKEY_RELEASES_S3_CREDS_JSON
  ? (JSON.parse(process.env.ENVKEY_RELEASES_S3_CREDS_JSON) as {
      accessKeyId: string;
      secretAccessKey: string;
    })
  : undefined;

export const PARAM_API_VERSION_NUMBER = "ApiVersionNumber";
export const PARAM_INFRA_VERSION_NUMBER = "InfraVersionNumber";

export const githubLatestVersionFiles: Record<Infra.ProjectType, string> = {
  api: `releases/api/api-version.txt`,
  cli: `releases/cli/cli-version.txt`,
  desktop: `releases/desktop/desktop-version.txt`,
  infra: `releases/infra/infra-version.txt`,
  failover: `releases/failover/failover-version.txt`,
  envkeysource: `releases/envkeysource/envkeysource-version.txt`,
  envkeyfetch: `releases/envkeyfetch/envkeyfetch-version.txt`,
};

export const githubApiMinInfraVersionFile =
  "public/app/api-version-to-minimum-infra-version.json";
export const apiToMinInfraMap = <Record<string, string>>(
  require("../../../api-version-to-minimum-infra-version.json")
);

export const installerFile = "installer.zip";
export const failoverFile = "failover.zip";
export const updaterFile = "updater.zip";
export const installerBuildspec = "installer-buildspec.yml";
export const updaterBuildspec = "updater-inception-buildspec.yml";

// Important: order matters as they will be destroyed in reverse order of below
export enum CfStack {
  ENVKEY_ECR_CI = "envkey-ecr-ci",
  ENVKEY_IN_REGION_BASE = "envkey-in-region-base",
  ENVKEY_IN_REGION_FAILOVER = "envkey-in-region-failover",
  ENVKEY_SERVERLESS_DB = "envkey-serverless-db",
  ENVKEY_MULTI_MASTER_DB = "envkey-multi-master-db",
  ENVKEY_FARGATE_API = "envkey-fargate-api",
  ENVKEY_SECONDARY_REGION_BASE = "envkey-secondary-region-base",
  ENVKEY_SECONDARY_REGION_FAILOVER = "envkey-secondary-region-failover",
  ENVKEY_ALERTS = "envkey-alerts",
  ENVKEY_DNS = "envkey-dns",
  ENVKEY_WAF_API = "envkey-waf-api",
  ENVKEY_WAF_FAILOVER = "envkey-waf-failover",
  ENVKEY_WAF_FAILOVER_SECONDARY = "envkey-waf-failover-secondary",
}

export const getFargateStackName = (deploymentTag: string) =>
  [CfStack.ENVKEY_FARGATE_API, deploymentTag].join("-");

export type DbVpcParams = {
  VPC: string;
  PrivateSubnets: string;
  PublicSubnets: string;
  DbSecurityGroup: string;
  DbCredentials: string;
  DbHost: string;
  PrivateRouteTable: string;
};

export const parseDbVpcParams = (jsonParams: string): DbVpcParams => {
  let dbVpcParams: DbVpcParams;
  try {
    dbVpcParams = JSON.parse(jsonParams);
  } catch (err) {
    console.log("DB and VPC params failed to parse", jsonParams, err);
    throw err;
  }

  for (let k of [
    <const>"VPC",
    <const>"PrivateSubnets",
    <const>"PublicSubnets",
    <const>"DbSecurityGroup",
    <const>"DbCredentials",
    <const>"DbHost",
    <const>"PrivateRouteTable",
  ]) {
    if (typeof dbVpcParams[k] !== "string" || !dbVpcParams[k]) {
      const err = new Error(
        `DB and VPC params invalid key: ${k}=${dbVpcParams[k]}`
      );
      console.log(err);
      throw err;
    }
  }

  return dbVpcParams;
};

// All AZs **must support SES SMTP**
// Not all of them do. Try:
// `aws --output=json --profile=envkey-host ec2 describe-vpc-endpoint-services --service-names com.amazonaws.us-east-1.email-smtp`
// Or create a VPC in each region, then attempt to add an Endpoint for `email-smtp`.

const virginia = "us-east-1";
const oregon = "us-west-2";
const sydney = "ap-southeast-2";
const ireland = "eu-west-1";
const frankfurt = "eu-central-1";

export const regionLabels = {
  [virginia]: "Virgina",
  [oregon]: "Oregon",
  [sydney]: "Sydney",
  [ireland]: "Ireland",
  [frankfurt]: "Frankfurt",
};

export type Region = keyof typeof regionLabels;

export const regions: Region[] = [virginia, oregon, sydney, ireland, frankfurt];

export type RegionSetting = {
  failoverRegion: Region;
};

export const primaryRegionSettings: Record<Region, RegionSetting> = {
  [virginia]: {
    failoverRegion: oregon,
  },
  [oregon]: {
    failoverRegion: virginia,
  },
  [sydney]: {
    failoverRegion: oregon,
  },
  [ireland]: {
    failoverRegion: frankfurt,
  },
  [frankfurt]: {
    failoverRegion: ireland,
  },
};

export const parameterStoreDeploymentKey = "/envkey/deployment_tags";

export const codebuildProjectNames = {
  initialInstall: (deploymentTag: string) =>
    `envkey-install-runner-${deploymentTag}`,
  updater: (deploymentTag: string) =>
    `envkey-api-update-runner-${deploymentTag}`,
  apiContainer: (deploymentTag: string) =>
    `envkey-api-container-build-${deploymentTag}`,
  loadtestContainer: (deploymentTag: string) =>
    `envkey-loadtest-container-build-${deploymentTag}`,
};

export const getSnsAlertTopicName = (deploymentTag: string) =>
  `envkey-app-alert-topic-${deploymentTag}`;
export const getSnsAlertTopicArn = (
  deploymentTag: string,
  primaryRegion: string,
  awsAccountId: string
) =>
  `arn:aws:sns:${primaryRegion}:${awsAccountId}:${getSnsAlertTopicName(
    deploymentTag
  )}`;

export const getSourcesBucketName = (deploymentTag: string) =>
  `envkey-sources-${deploymentTag}`;

export const getFailoverBucketName = (deploymentTag: string) =>
  `envkey-in-region-code-${deploymentTag}`;

export const getSecondaryFailoverBucketName = (deploymentTag: string) =>
  `envkey-secondary-code-${deploymentTag}`;

export const getEcrStackName = (deploymentTag: string) =>
  CfStack.ENVKEY_ECR_CI + "-" + deploymentTag;

export const getEcrRepoName = (deploymentTag: string) =>
  `envkey-api-${deploymentTag}`;

export const getCodebuildRoleName = (deploymentTag: string) =>
  `envkey-codebuild-role-${deploymentTag}`;
export const getCodebuildInstallLink = (
  deploymentTag: string,
  primaryRegion: string,
  awsAccountId: string
) =>
  `https://console.aws.amazon.com/codesuite/codebuild/${awsAccountId}/projects/${codebuildProjectNames.initialInstall(
    deploymentTag
  )}/history?region=${primaryRegion}`;

export const getCodebuildUpdateLink = (
  deploymentTag: string,
  primaryRegion: string,
  awsAccountId: string
) =>
  `https://console.aws.amazon.com/codesuite/codebuild/${awsAccountId}/projects/${codebuildProjectNames.updater(
    deploymentTag
  )}/history?region=${primaryRegion}`;

// the secret value is json of type `OptionalAwsCreds`
export const getS3CredsSecretName = (deploymentTag: string) =>
  `envkey-s3-releases-creds-${deploymentTag}`;

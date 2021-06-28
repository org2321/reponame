import CodeBuild from "aws-sdk/clients/codebuild";
import { codebuildProjectNames } from "@infra/stack-constants";

export const bootstrapUpdate = async (params: {
  deploymentTag: string;
  apiVersionNumber?: string;
  infraVersionNumberTo?: string;
  usingUpdaterVersion?: string;
}) => {
  const primaryRegion = process.env.AWS_REGION;
  const codeBuild = new CodeBuild({
    region: primaryRegion,
  });

  await codeBuild
    .startBuild({
      projectName: codebuildProjectNames.updater(params.deploymentTag),
      environmentVariablesOverride: [
        {
          name: "API_VERSION_NUMBER",
          value: params.apiVersionNumber || "",
        },
        {
          name: "INFRA_VERSION_NUMBER_TO",
          value: params.infraVersionNumberTo || "",
        },
        {
          name: "RUN_FROM_INFRA_VERSION_NUMBER_OVERRIDE",
          value: params.usingUpdaterVersion || "",
        },
      ],
    })
    .promise();
};

import { clientAction, dispatch } from "../handler";
import { Client, Api, Infra } from "@core/types";
import { bootstrapSelfHostedDeployment } from "@infra/bootstrap-deployments";
import { generateDeploymentTag, generateSubdomain } from "@core/lib/infra";
import { log } from "@core/lib/utils/logger";
import {
  ENVKEY_RELEASES_BUCKET,
  getCodebuildInstallLink,
} from "@infra/stack-constants";
import { getAwsAccountId, preDeployValidations } from "@infra/aws-helpers";
import {
  listVersionsGT,
  readReleaseNotesFromS3,
} from "@infra/artifact-helpers";
import { statusProducers } from "../lib/status";
import * as semver from "semver";
import * as R from "ramda";

const MAX_RELEASE_NOTES = 10;

clientAction<
  Client.Action.ClientActions["DeploySelfHosted"],
  Client.PendingSelfHostedDeployment
>({
  type: "asyncClientAction",
  actionType: Client.ActionType.DEPLOY_SELF_HOSTED,
  stateProducer: (draft, action) => {
    delete draft.deploySelfHostedError;
    draft.isDeployingSelfHosted = true;
  },
  successStateProducer: (draft, { payload }) => {
    draft.pendingSelfHostedDeployments.push(payload);
  },
  failureStateProducer: (draft, { payload }) => {
    draft.deploySelfHostedError = payload;
  },
  endStateProducer: (draft, action) => {
    delete draft.isDeployingSelfHosted;
    delete draft.deploySelfHostedStatus;
  },
  handler: async (
    state,
    { payload },
    { context, dispatchSuccess, dispatchFailure }
  ) => {
    const subdomain = generateSubdomain();
    const deploymentTag = generateDeploymentTag();

    const bootstrapParams = {
      ...payload,
      subdomain,
      deploymentTag,
      updateStatus: (status: string) => {
        dispatch(
          {
            type: Client.ActionType.SET_DEPLOY_SELF_HOSTED_STATUS,
            payload: { status },
          },
          context
        );
      },
    };

    try {
      await preDeployValidations(
        payload.profile,
        payload.primaryRegion,
        payload.domain,
        payload.customDomain,
        payload.verifiedSenderEmail
      );
      const [awsAccountId] = await Promise.all([
        getAwsAccountId(payload.profile),
        bootstrapSelfHostedDeployment(bootstrapParams),
      ]);

      const codebuildLink = getCodebuildInstallLink(
        deploymentTag,
        payload.primaryRegion,
        awsAccountId
      );

      return dispatchSuccess(
        {
          ...payload,
          type: "pendingSelfHostedDeployment",
          hostUrl: `${subdomain}.${payload.domain}`,
          addedAt: Date.now(),
          subdomain,
          domain: payload.domain,
          deploymentTag,
          codebuildLink,
        },
        context
      );
    } catch (err) {
      log("failed bootstrapping self-hosted", { err, bootstrapParams });
      return dispatchFailure(
        {
          type: "error",
          error: true,
          errorStatus: 500,
          errorReason: err.message,
        } as Api.Net.ErrorResult,
        context
      );
    }
  },
});

clientAction<Client.Action.ClientActions["SetDeploySelfHostedStatus"]>({
  type: "clientAction",
  actionType: Client.ActionType.SET_DEPLOY_SELF_HOSTED_STATUS,
  stateProducer: (draft, { payload: { status } }) => {
    draft.deploySelfHostedStatus = status;
  },
});

clientAction<
  Client.Action.ClientActions["CheckSelfHostedUpgradesAvailable"],
  Client.State["selfHostedUpgradesAvailable"]
>({
  type: "asyncClientAction",
  actionType: Client.ActionType.CHECK_SELF_HOSTED_UPGRADES_AVAILABLE,
  stateProducer: (draft, action) => {
    delete draft.checkSelfHostedUpgradesAvailableError;
    draft.isCheckingSelfHostedUpgradesAvailable = true;
  },
  successStateProducer: (draft, { payload }) => {
    draft.selfHostedUpgradesAvailable = payload;
  },
  failureStateProducer: (draft, { payload }) => {
    draft.checkSelfHostedUpgradesAvailableError = payload;
  },
  endStateProducer: (draft, action) => {
    delete draft.isCheckingSelfHostedUpgradesAvailable;
  },
  handler: async (
    state,
    { payload },
    { context, dispatchSuccess, dispatchFailure }
  ) => {
    let apiVersionsAvailable: string[];
    let infraVersionsAvailable: string[];

    const fromApiVersion = payload.lowestCurrentApiVersion;
    const fromInfraVersion = payload.lowestCurrentInfraVersion;

    try {
      // Note that this will only work for public release or public release candidates. Testing
      // private or pre-releases will need to be done using private releaser's dev-api-api,
      // or by some other method (future - like setting a different public bucket at
      // ENVKEY_RELEASES_BUCKET with pre-releases)
      [apiVersionsAvailable, infraVersionsAvailable] = await Promise.all([
        listVersionsGT({
          tagPrefix: "api",
          currentVersionNumber: fromApiVersion,
          bucket: ENVKEY_RELEASES_BUCKET,
        }),
        listVersionsGT({
          tagPrefix: "infra",
          currentVersionNumber: fromInfraVersion,
          bucket: ENVKEY_RELEASES_BUCKET,
        }),
      ]);

      log("api versions available:", apiVersionsAvailable);
      log("infra versions available:", infraVersionsAvailable);
    } catch (err) {
      return dispatchFailure(err, context);
    }

    if (
      apiVersionsAvailable.length == 0 &&
      infraVersionsAvailable.length == 0
    ) {
      log("No new self-hosted upgrades available.");
      return dispatchSuccess(state.selfHostedUpgradesAvailable, context);
    }

    const available: Client.State["selfHostedUpgradesAvailable"] = R.clone(
      state.selfHostedUpgradesAvailable
    );
    const releaseNotesPromises: Promise<
      [Infra.ProjectType, string, string]
    >[] = [];

    for (let [project, versions, fromVersion] of <const>[
      ["api", apiVersionsAvailable, fromApiVersion],
      ["infra", infraVersionsAvailable, fromInfraVersion],
    ]) {
      if (versions.length == 0) {
        continue;
      }

      // these are in descending order, so latest versions are at 0 index
      const latest = versions[0];
      if (!available[project]) {
        available[project] = { latest, releaseNotes: {} };
      }
      available[project]!.latest = latest;

      log(
        `Self-hosted ${project} upgrade available. Lowest current version: ${fromVersion}. Latest version: ${latest}. Fetching release notes for up to ${MAX_RELEASE_NOTES} most recent versions.`
      );

      if (latest && semver.gt(latest, fromVersion)) {
        // rate limits used to apply, but now with S3 they don't exist, so we could show all notes if we wanted
        const limited = versions.slice(0, MAX_RELEASE_NOTES);
        log(`queuing release note promises: ${project}`);

        for (let version of limited) {
          if (available[project]?.releaseNotes[version]) {
            continue;
          }
          releaseNotesPromises.push(
            readReleaseNotesFromS3({
              project,
              version,
              bucket: ENVKEY_RELEASES_BUCKET,
            }).then((notes) => [project, version, notes])
          );
        }
      }
    }

    log("Fetching release notes..");
    try {
      const notesRes = await Promise.all(releaseNotesPromises);

      return dispatchSuccess(
        notesRes.reduce(
          (agg, [project, version, notes]) =>
            R.assocPath([project, "releaseNotes", version], notes, agg),
          available
        ),

        context
      );
    } catch (err) {
      log("Error fetching release notes:", { err });

      return dispatchFailure(err, context);
    }
  },
});

clientAction<Client.Action.ClientActions["SkipUpgradeForNow"]>({
  type: "clientAction",
  actionType: Client.ActionType.SKIP_SELF_HOSTED_UPGRADE_FOR_NOW,
  procStateProducer: (draft) => {
    draft.skippedSelfHostedUpgradeAt = Date.now();
  },
});

clientAction<Client.Action.ClientActions["ClearPendingSelfHostedDeployment"]>({
  type: "clientAction",
  actionType: Client.ActionType.CLEAR_PENDING_SELF_HOSTED_DEPLOYMENT,
  procStateProducer: (draft, { payload }) => {
    draft.pendingSelfHostedDeployments = draft.pendingSelfHostedDeployments.filter(
      ({ deploymentTag }) => deploymentTag != payload.deploymentTag
    );
  },
});

clientAction<
  Api.Action.RequestActions["UpgradeSelfHosted"],
  Api.Net.ApiResultTypes["UpgradeSelfHosted"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.UPGRADE_SELF_HOSTED,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  successStateProducer: (draft) => {
    delete draft.skippedSelfHostedUpgradeAt;
    draft.selfHostedUpgradesAvailable = {};
  },
  ...statusProducers(
    "isDispatchingSelfHostedUpgrade",
    "upgradeSelfHostedError"
  ),
});

clientAction<
  Api.Action.RequestActions["UpgradeSelfHostedForceClear"],
  Api.Net.ApiResultTypes["UpgradeSelfHostedForceClear"]
>({
  type: "apiRequestAction",
  actionType: Api.ActionType.UPGRADE_SELF_HOSTED_FORCE_CLEAR,
  loggableType: "orgAction",
  authenticated: true,
  graphAction: true,
  ...statusProducers(
    "isDispatchingUpgradeForceClear",
    "upgradeForceClearError"
  ),
});

import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore, refreshState } from "../../lib/core";
import { BaseArgs } from "../../types";
import { promptAcceptInviteOrDeviceGrantSecurityOptions } from "../../lib/crypto";
import { Api, Auth, Client, Model } from "@core/types";
import { logAndExitIfActionFailed } from "../../lib/args";
import { printAccount } from "../../lib/auth";
import chalk from "chalk";
import { getActiveOrgUserDevicesByUserId } from "@core/lib/graph";
import { wait } from "@core/lib/utils/wait";
import * as util from "util";
import { autoModeOut, getPrompt } from "../../lib/console_io";

export const command = "accept-invite";
export const desc =
  "Join an organization or authorize a device by accepting an invitation.";
// command and describe are defined where used
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .option("invite-token", {
      alias: "i",
      type: "string",
      describe: "Invite token, sent by EnvKey to your email",
    })
    .option("encryption-token", {
      alias: "e",
      type: "string",
      describe:
        "Encryption token, sent by the user who invited you or authorized your device",
    })
    .option("name", {
      type: "string",
      describe: "Name for the newly authorized device",
    });
export const handler = async (
  argv: BaseArgs & {
    "invite-token"?: string;
    "encryption-token"?: string;
    name?: string;
  }
): Promise<void> => {
  const prompt = getPrompt();
  const { state: initialState } = await initCore(argv, false);
  let state = initialState;
  let completedInviteExternalAuth:
    | typeof state.completedInviteExternalAuth
    | undefined;
  const emailToken = (argv["invite-token"] ??
    (
      await prompt<{ invite_token: string }>({
        type: "password",
        name: "invite_token",
        message: "Invite token:",
      })
    ).invite_token) as string;
  const encryptionToken = (argv["encryption-token"] ??
    (
      await prompt<{ encryption_token: string }>({
        type: "password",
        name: "encryption_token",
        message: "Encryption token:",
      })
    ).encryption_token) as string;

  const split = emailToken.split("_");
  if (!split || split.length < 3) {
    return exit(1, chalk.red.bold("Email invite token is the wrong format!"));
  }

  // "i" = invite, "dg" = device grant.
  const prefix = split[0] as "i" | "dg";
  let loadActionType:
    | Client.ActionType.LOAD_INVITE
    | Client.ActionType.LOAD_DEVICE_GRANT;
  let acceptActionType:
    | Client.ActionType.ACCEPT_INVITE
    | Client.ActionType.ACCEPT_DEVICE_GRANT;
  switch (prefix) {
    case "i":
      loadActionType = Client.ActionType.LOAD_INVITE;
      acceptActionType = Client.ActionType.ACCEPT_INVITE;
      break;
    case "dg":
      loadActionType = Client.ActionType.LOAD_DEVICE_GRANT;
      acceptActionType = Client.ActionType.ACCEPT_DEVICE_GRANT;
      break;
    default:
      return exit(1, "Email token should start with 'i_' or 'dg_'");
  }

  const loadRes = await dispatch({
    type: loadActionType,
    payload: {
      emailToken,
      encryptionToken,
    },
  });
  let needsExternalLogin =
    (loadRes.resultAction as any).payload?.type === "requiresExternalAuthError";
  // Redirect to login URL in the background
  if (!needsExternalLogin) {
    // just check that the normal email provider invite/devicegrant was loaded.
    await logAndExitIfActionFailed(loadRes, "Invite could not be loaded!");
    state = loadRes.state;
  } else {
    // user must authenticate with an external provider, then core proc will load the invite/devicegrant
    const {
      id: inviteId,
      provider,
      externalAuthProviderId,
      orgId,
    } = (loadRes.resultAction as any)
      .payload as Api.Net.RequiresExternalAuthResult;
    if (!provider || !externalAuthProviderId || !orgId) {
      return exit(
        1,
        chalk.bold.red(
          "Not enough information to authenticate using external provider! There may be a configuration problem.\n"
        ) + JSON.stringify({ provider, externalAuthProviderId, orgId })
      );
    }

    const authMethod = Auth.PROVIDER_AUTH_METHODS[provider];

    switch (authMethod) {
      case "saml":
        await handleSamlLogin({
          inviteId,
          emailToken,
          encryptionToken,
          externalAuthProviderId,
          loadActionType,
          orgId,
        });
        state = await refreshState();
        while (!state.completedInviteExternalAuth) {
          process.stderr.write(".");
          await wait(950);
          state = await refreshState();
          if (state.authorizingExternallyErrorMessage) {
            await exit(
              1,
              util.inspect(state.authorizingExternallyErrorMessage)
            );
          }
        }
        completedInviteExternalAuth = state.completedInviteExternalAuth!;
        break;
      case "oauth_hosted":
        return exit(1, "Hosted OAuth is not yet supported");
      case "oauth_cloud":
        return exit(1, "OAuth cloud is not yet supported");
      default:
        return exit(
          1,
          chalk.red.bold(
            "Error setting up external auth provider",
            provider,
            authMethod,
            "not supported"
          )
        );
    }
  }

  console.log(chalk.bold("Invite loaded and verified."));

  const accountId =
    completedInviteExternalAuth?.userId ??
    (state.loadedInvite?.inviteeId ?? state.loadedDeviceGrant?.granteeId)!;
  const sentById =
    completedInviteExternalAuth?.sentById ??
    (state.loadedInvite?.invitedByUserId ??
      state.loadedDeviceGrant?.grantedByUserId)!;

  state = await refreshState(accountId);

  const invitedOrGrantedBy = state.graph[sentById] as
    | Model.OrgUser
    | Model.CliUser;
  if (!invitedOrGrantedBy) {
    await exit(
      1,
      "Failed loading the user who initiated this invitation! " + sentById
    );
  }

  let senderId: string;
  let sender: string;
  if (invitedOrGrantedBy.type == "orgUser") {
    senderId = invitedOrGrantedBy.id;
  } else {
    senderId = invitedOrGrantedBy.signedById;
  }
  const { email, firstName, lastName } = state.graph[senderId] as Model.OrgUser;
  sender = `${firstName} ${lastName} <${email}>`;

  console.log("Sent by:", chalk.bold(sender));

  console.log(
    chalk.bold(
      "Please ensure you know and trust this sender before proceeding."
    )
  );

  const existingDeviceNames = new Set(
    (getActiveOrgUserDevicesByUserId(state.graph)[accountId] ?? []).map(
      ({ name }) => name.trim().toLowerCase()
    )
  );

  const deviceName = (argv.name ??
      (
        await prompt<{ deviceName: string }>({
          type: "input",
          name: "deviceName",
          required: true,
          initial: initialState.defaultDeviceName,
          message: "Name of this device:",
          validate: (val) =>
            existingDeviceNames.has(val.trim().toLowerCase())
              ? "You already have a device with this name"
              : true,
        })
      ).deviceName) as string,
    orgId = (state.loadedInviteOrgId ?? state.loadedDeviceGrantOrgId)!,
    org = state.graph[orgId] as Model.Org,
    { passphrase, lockoutMs } =
      await promptAcceptInviteOrDeviceGrantSecurityOptions(initialState, org);

  const acceptRes = await dispatch(
    {
      type: acceptActionType,
      payload: { deviceName, emailToken, encryptionToken },
    },
    accountId
  );

  await logAndExitIfActionFailed(acceptRes, "Failed accepting the invite!");

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

  const isDefault = acceptRes.state.defaultAccountId == accountId;

  printAccount(
    accountId,
    acceptRes.state.orgUserAccounts[accountId]!,
    isDefault,
    state.graph
  );

  autoModeOut({ id: accountId, isDefault });

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

const handleSamlLogin = async (params: {
  emailToken: string;
  encryptionToken: string;
  externalAuthProviderId: string;
  orgId: string;
  inviteId: string;
  loadActionType:
    | Client.ActionType.LOAD_INVITE
    | Client.ActionType.LOAD_DEVICE_GRANT;
}) => {
  const {
    emailToken,
    encryptionToken,
    externalAuthProviderId,
    orgId,
    loadActionType,
    inviteId,
  } = params;

  console.log(
    "Generating external auth request. You will be prompted to log in with SAML."
  );
  const res = await dispatch({
    type: Client.ActionType.CREATE_EXTERNAL_AUTH_SESSION_FOR_INVITE,
    payload: {
      authMethod: "saml",
      provider: "saml",
      authType:
        loadActionType === Client.ActionType.LOAD_INVITE
          ? "accept_invite"
          : "accept_device_grant",
      authObjectId: inviteId,
      externalAuthProviderId,
      orgId,
      loadActionType,
      emailToken,
      encryptionToken,
    },
  });
  await logAndExitIfActionFailed(res, "Failed creating SAML pending session!");
};

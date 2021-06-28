import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { authz } from "@core/lib/graph";
import { Api, Model } from "@core/types";
import chalk from "chalk";
import { logAndExitIfActionFailed } from "../../lib/args";
import { getPrompt } from "../../lib/console_io";
import {tryApplyEnvkeyOverride} from "../../envkey_detection";

export const command = ["invite-revoke", "revoke-invite"];
export const desc = "Revoke a pending user invitation.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .option("all", {
      type: "boolean",
      describe: "Revoke all outstanding user invitations",
    })
    .option("force", {
      type: "boolean",
      describe: "Bypass confirmation and delete all",
    });
export const handler = async (
  argv: BaseArgs & { all?: boolean; force?: boolean }
): Promise<void> => {
  const prompt = getPrompt();
  const { state, auth } = await initCore(argv, true);
  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }

  const revokableInvites = authz
    .getRevokableInvites(state.graph, auth.userId, Date.now())
    .map((i) => {
      const user = state.graph[i.inviteeId]! as Model.OrgUser;
      return {
        name: i.id,
        message: `${chalk.bold(user.email)} - ${user.firstName} ${
          user.lastName
        }`,
      };
    });
  if (!revokableInvites.length) {
    return exit(1, "There are no revokable invites available.");
  }
  if (argv["all"]) {
    console.log(`Revoking ${revokableInvites.length} invites...`);

    if (!argv["force"]) {
      await conf();
    }

    for (const invite of revokableInvites) {
      const res = await dispatch({
        type: Api.ActionType.REVOKE_INVITE,
        payload: {
          id: invite.name,
        },
      });
      await logAndExitIfActionFailed(
        res,
        `Failed revoking the invite for ${invite.message}! Aborting.`
      );
      console.log(`Revoked invite for ${chalk.bold(invite.message)}.`);
    }
    return exit();
  }

  const { inviteId } = await prompt<{ inviteId: string }>({
    type: "select",
    name: "inviteId",
    message: "Select invited user:",
    choices: revokableInvites,
  });

  const res = await dispatch({
    type: Api.ActionType.REVOKE_INVITE,
    payload: {
      id: inviteId,
    },
  });
  await logAndExitIfActionFailed(res, "Failed revoking the invite!");

  console.log(chalk.bold("The invite was revoked successfully."));

  return exit();
};

const conf = async (): Promise<void> => {
  const prompt = getPrompt();
  const { confirm } = await prompt<{ confirm: boolean }>({
    type: "confirm",
    name: "confirm",
    message: chalk.bold(`Revoke? This action cannot be reversed!`),
  });

  if (!confirm) {
    console.log(chalk.bold("User deletion aborted!"));
    return exit();
  }
};

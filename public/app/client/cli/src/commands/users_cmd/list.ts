import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import { graphTypes } from "@core/lib/graph";
import chalk from "chalk";
import Table from "cli-table3";
import * as R from "ramda";
import { Auth, Model, Rbac } from "@core/types";
import { autoModeOut } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["list", "ls"];
export const desc = "List organization users.";
export const builder = (yargs: Argv<BaseArgs>) => yargs;
export const handler = async (argv: BaseArgs): Promise<void> => {
  const { state, auth } = await initCore(argv, true);
  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }

  const table = new Table({
    head: [
      "Email",
      "User Name",
      "Org Role Name",
      "Auth Provider",
      "Provisioning",
      "Devices",
    ],
    style: {
      head: [], // disable colors in header cells
    },
  });

  const orgUsers = R.sort(
    R.ascend(R.prop("email")),
    graphTypes(state.graph).orgUsers
  ) as Model.OrgUser[];

  for (let user of orgUsers) {
    const orgRole = state.graph[user.orgRoleId] as Rbac.OrgRole;
    const devices = graphTypes(state.graph).orgUserDevices.filter(
      R.propEq("userId", user.id)
    );
    const devicesDisplay = [
      `${chalk.bold(devices.length)}`,
      ...devices.map(R.prop("name")),
    ].join("\n- ");
    let authProviderInfo = Auth.AUTH_PROVIDERS[user.provider];
    if (
      user.externalAuthProviderId &&
      state.graph[user.externalAuthProviderId]
    ) {
      authProviderInfo +=
        "\n" +
        (state.graph[user.externalAuthProviderId] as Model.ExternalAuthProvider)
          ?.nickname;
    }

    table.push([
      chalk.bold(user.email),
      chalk.bold([user.firstName ?? "", user.lastName ?? ""].join(" ")),
      orgRole.name,
      authProviderInfo,
      user.scim
        ? (state.graph[user.scim.providerId] as Model.ScimProvisioningProvider)
            ?.nickname + `\nID=${user.scim.candidateId}`
        : chalk.gray("None"),
      devicesDisplay,
    ]);
  }

  console.log(table.toString());
  autoModeOut({
    orgUsers: orgUsers.map((user) => R.pick(["id", "email"], user)),
  });

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

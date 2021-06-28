import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import chalk from "chalk";
import { authz, graphTypes } from "@core/lib/graph";
import { Model } from "@core/types";
import Table from "cli-table3";
import { fetchScimCandidates } from "../../lib/scim_client_helpers";
import * as R from "ramda";
import { autoModeOut, getPrompt } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["scim [provider]"];
export const desc = "Get status info about SCIM provisioning providers.";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("provider-id", {
      type: "string",
    })
    .option("info", {
      type: "boolean",
      describe: "Print info about the provider",
    })
    .option("users", {
      type: "boolean",
      describe: "List all users",
    });
export const handler = async (
  argv: BaseArgs & { provider?: string; info?: boolean; users?: boolean }
): Promise<void> => {
  const prompt = getPrompt();
  const { auth, state } = await initCore(argv, true);
  let providerId = argv["provider"] as string | undefined;
  let showInfo = argv["info"] as boolean | undefined;
  let showUsers = argv["users"] as boolean | undefined;

  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }

  if (
    !authz.hasOrgPermission(
      state.graph,
      auth.userId,
      "org_manage_auth_settings"
    )
  ) {
    return exit(
      1,
      "Not allowed to manage automatic user provisioning settings"
    );
  }

  const providers = graphTypes(state.graph).scimProvisioningProviders;
  if (!providers.length) {
    console.error("There are no SCIM providers");
    return exit();
  }

  if (!providerId) {
    if (providers.length === 1) {
      providerId = providers[0].id;
    } else {
      ({ providerId } = await prompt<{ providerId: string }>({
        type: "select",
        name: "providerId",
        required: true,
        message: "Select the SCIM provider",
        choices: providers.map((p) => ({
          name: p.id,
          message: `${p.nickname}`,
        })),
      }));
    }
  }

  const provider = (state.graph[<string>providerId] ??
    providers.find(
      (p) => p.nickname === providerId
    )) as Model.ScimProvisioningProvider;

  if (!provider) {
    return exit(1, "SCIM provider not found: " + providerId);
  }

  if (!showInfo && !showUsers) {
    ({ showInfo } = await prompt<{ showInfo: boolean }>({
      type: "confirm",
      name: "showInfo",
      message: "Show info about the provider?",
    }));
    ({ showUsers } = await prompt<{ showUsers: boolean }>({
      type: "confirm",
      name: "showUsers",
      message: "List users from this provider?",
    }));
  }

  if (showInfo) {
    const table = new Table({
      colWidths: [],
      style: {
        head: [], //disable colors in header cells
      },
    });
    table.push(
      ["Nickname", provider.nickname],
      ["ID", provider.id],
      ["Auth Scheme", provider.authScheme],
      ["Endpoint Base URL", provider.endpointBaseUrl]
    );

    console.log(table.toString());
    autoModeOut(R.pick(["id", "endpointBaseUrl"], provider));
  }

  if (showUsers) {
    const table = new Table({
      colWidths: [],
      style: {
        head: [], //disable colors in header cells
      },
      head: [
        chalk.bold("Active?"),
        chalk.bold("Email"),
        chalk.bold("Name, Display, UserName"),
        chalk.bold("External ID"),
        chalk.bold("EnvKey Candidate ID"),
        chalk.bold("EnvKey Org User ID"),
      ],
    });

    const activeEmailSort = R.sortWith([
      R.descend(R.prop("active")),
      R.ascend(R.prop("email")) as any,
    ]);
    const allCandidates = activeEmailSort(
      await fetchScimCandidates(provider.id, true)
    ) as Model.ScimUserCandidate[];
    for (const u of allCandidates) {
      table.push([
        u.active,
        u.email,
        [
          [u.firstName, u.lastName].join(" "),
          u.scimDisplayName,
          u.scimUserName,
        ].join("\n"),
        u.scimExternalId,
        u.id,
        u.orgUserId ? u.orgUserId : chalk.gray("Not Invited"),
      ]);
    }

    console.log(chalk.bold("\nSCIM Users"));
    console.log(table.toString());
    autoModeOut({
      providerId: provider.id,
      users: allCandidates.map((c) =>
        R.pick(["id", "active", "orgUserId", "email", "id", "scimUserName"], c)
      ),
    });
  }

  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};

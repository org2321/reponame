import * as z from "zod";
import chalk from "chalk";
import fs from "fs";
import { Api, Client, Model } from "@core/types";
import { Graph } from "@core/types/client/graph";
import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { dispatch, initCore } from "../../lib/core";
import { BaseArgs } from "../../types";
import {
  logAndExitIfActionFailed,
  sortByPredefinedOrder,
} from "../../lib/args";
import { OrgRole } from "@core/types/rbac";
import Table from "cli-table3";
import {
  getActiveOrgUserDevicesByUserId,
  getActiveInvites,
  getActiveDeviceGrants,
  graphTypes,
  authz,
} from "@core/lib/graph";
import { fetchScimCandidates } from "../../lib/scim_client_helpers";
import { autoModeOut, getPrompt } from "../../lib/console_io";
import {tryApplyEnvkeyOverride} from "../../envkey_detection";

const clipboardy = require("clipboardy");

const isEmailValidator = (value: string): boolean => {
  try {
    z.string().email().parse(value);
  } catch (err) {
    console.error(chalk.red.bold(err.message));
    return false;
  }
  return true;
};

const JsonUserInviteSchema = z.array(
  z.object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    role: z.string(),
  })
);

const findOrgRoleId = (
  graph: Graph.UserGraph,
  userId: string,
  name: string
) => {
  const orgRoles = authz.getInvitableOrgRoles(graph, userId);
  const found = orgRoles.find(
    (or) => or.defaultName === name || or.name === name || or.id === name
  );
  if (!found) {
    throw new Error(
      `Org role does not exist by name ${name}, or is not invitable`
    );
  }
  return found.id;
};

export const command = ["invite [email] [first] [last] [org_role]"];
export const desc =
  "Invite a new user, or multiple users with --from-json-file";
export const builder = (yargs: Argv<BaseArgs>) =>
  yargs
    .positional("email", {
      type: "string",
    })
    .positional("first", {
      type: "string",
    })
    .positional("last", {
      type: "string",
    })
    .positional("org_role", {
      type: "string",
    })
    .option("from-json-file", {
      type: "string",
      alias: "j",
      describe: "Only available for email provider",
    })
    .option("saml", {
      type: "boolean",
      describe: "set provider to saml",
    });
export const handler = async (
  argv: BaseArgs & {
    email?: string;
    first?: string;
    last?: string;
    org_role?: string;
    "from-json-file"?: string;
    saml?: boolean;
  }
): Promise<void> => {
  const prompt = getPrompt();
  let { state, auth } = await initCore(argv, true);
  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }
  let scimProvider: Model.ScimProvisioningProvider | undefined;
  let firstName: string | undefined = argv["first"];
  let lastName: string | undefined = argv["last"];
  let email: string | undefined = argv["email"];
  let orgRoleId: string | undefined = argv["org_role"]
    ? authz
        .getInvitableOrgRoles(state.graph, auth.userId)
        ?.find((or) =>
          [or.id.toLowerCase(), or.defaultName?.toLowerCase(), or.name.toLowerCase()].includes(argv["org_role"]!.toLowerCase())
        )?.id
    : undefined;
  let candidateId: string | undefined;
  const scimProvisioningProviders = graphTypes(state.graph)
    .scimProvisioningProviders;
  const now = Date.now();

  if (!authz.canInviteAny(state.graph, auth.userId)) {
    return exit(1, chalk.red(`You do not have permission to invite a user.`));
  }
  const selectOrgRole = orgRoleId
    ? undefined
    : {
        type: "select",
        name: "orgRoleId",
        message: "Organization Role:",
        required: true,
        initial: 0,
        choices: sortByPredefinedOrder(
          ["Basic User", "Org Admin", "Org Owner"],
          authz.getInvitableOrgRoles(state.graph, auth.userId),
          "defaultName"
        ).map((or) => ({
          name: or.id,
          message: `${chalk.bold(or.name)} - ${or.description}`,
        })),
      };

  const numActiveDevices = Object.values(
    getActiveOrgUserDevicesByUserId(state.graph)
  ).flat().length;
  const numActiveInvites = getActiveInvites(state.graph, now).length;
  const numActiveGrants = getActiveDeviceGrants(state.graph, now).length;
  const numActive = numActiveDevices + numActiveInvites + numActiveGrants;
  const license = graphTypes(state.graph).license;

  const licenseExpired = license.expiresAt != -1 && now > license.expiresAt;
  if (numActive >= license.maxDevices || licenseExpired) {
    let message =
      chalk.red(
        licenseExpired
          ? `Your org's ${
              license.provisional ? "provisional " : ""
            }license has expired.`
          : `Your org has reached its limit of ${license.maxDevices} devices.`
      ) + "\n";
    if (
      authz.hasOrgPermission(state.graph, auth.userId, "org_manage_billing")
    ) {
      message += `To invite more users, ${
        licenseExpired ? "renew" : "upgrade"
      } your org's license.`;
    } else {
      message += `To invite more users, ask an admin to ${
        licenseExpired ? "renew" : "upgrade"
      } your org's license.`;
    }
    return exit(1, message);
  }

  let payload:
    | Pick<Api.Net.ApiParamTypes["CreateInvite"], "user" | "scim">[]
    | undefined;
  let externalAuthProviderId: string | undefined;
  const samlProviders = graphTypes(state.graph).externalAuthProviders.filter(
    (p) => p.provider === "saml"
  );
  const hasSaml = samlProviders.length > 0;
  let provider: "saml" | "email" | undefined =
    argv["saml"] && hasSaml ? "saml" : undefined;

  if (argv["from-json-file"]) {
    await doBulkJsonEmailImportOrBust(
      state.graph,
      auth.userId,
      argv["from-json-file"]
    );

    return exit(0);
  }

  if (hasSaml) {
    if (!provider) {
      // user may have used saml flag to auto-select
      ({ provider } = await prompt<{ provider: "saml" | "email" }>({
        type: "select",
        name: "provider",
        message: "Select auth method for the user",
        choices: ["saml", "email"],
        required: true,
      }));
    }

    if (provider === "saml") {
      if (samlProviders.length === 1) {
        externalAuthProviderId = samlProviders[0].id;
      } else {
        ({ externalAuthProviderId } = await prompt<{
          externalAuthProviderId: string;
        }>({
          type: "select",
          name: "externalAuthProviderId",
          message: "Choose from your configured SAML providers",
          choices: samlProviders.map((p) => ({
            name: p.id,
            message: p.nickname,
          })),
          required: true,
        }));
      }
      console.log(
        "Using SAML provider",
        samlProviders.find((p) => p.id === externalAuthProviderId)!.nickname
      );
    }
  } else {
    provider = "email";
  }

  if (scimProvisioningProviders.length > 0) {
    const { choice } = await prompt<{ choice: "email" | "scim" }>({
      type: "select",
      required: true,
      name: "choice",
      message: "How would you like to invite users?",
      choices: [
        {
          name: "scim",
          message: "From list of provisioned users (SCIM)",
        },
        {
          name: "email",
          message: "Using email",
        },
      ],
    });
    if (choice === "scim") {
      if (scimProvisioningProviders.length == 1) {
        scimProvider = scimProvisioningProviders[0];
      } else {
        // multiple providers
        const { scimProviderId } = await prompt<{ scimProviderId: string }>({
          type: "select",
          name: "scimProviderId",
          message: "Choose the SCIM provider",
          required: true,
          choices: scimProvisioningProviders.map((s) => ({
            name: s.id,
            message: s.nickname,
          })),
        });
        scimProvider = state.graph[
          scimProviderId
        ] as Model.ScimProvisioningProvider;
      }
    }
  }

  if (scimProvider) {
    const candidates = await fetchScimCandidates(scimProvider.id);
    if (!candidates?.length) {
      return exit(1, "Nobody available to invite from SCIM.");
    }
    ({ candidateId, orgRoleId } = await prompt<{
      candidateId: string;
      orgRoleId: string;
    }>([
      {
        type: "select",
        name: "candidateId",
        message: "Choose somebody",
        required: true,
        choices: candidates.map((c) => ({
          name: c.id,
          message: `${c.email} (${c.scimUserName}, ${c.scimExternalId}) ${
            c.scimDisplayName || ""
          } - ${c.firstName} ${c.lastName}`,
        })),
      },
      selectOrgRole,
    ]));
    const candidate = candidates.find((c) => c.id === candidateId)!;
    firstName = candidate.firstName;
    lastName = candidate.lastName;
    email = candidate.email;
    // end invite from scim
  } else if (!email || !firstName || !lastName || !orgRoleId) {
    // not scimProvider, or no users available to invite from scim.
    // default behavior
    ({ email, firstName, lastName, orgRoleId } = await prompt<{
      email: string;
      firstName: string;
      lastName: string;
      orgRoleId: string;
    }>([
      {
        type: "input",
        name: "firstName",
        message: "First name:",
        initial: argv["first"] || "",
        required: true,
      },
      {
        type: "input",
        name: "lastName",
        message: "Last name:",
        initial: argv["last"] || "",
        required: true,
      },
      {
        type: "input",
        name: "email",
        message: "Email:",
        initial: argv["email"] || "",
        validate: isEmailValidator,
      },
      selectOrgRole,
    ]));
  }

  payload = [
    {
      user: {
        provider,
        externalAuthProviderId,
        email: email!,
        uid: email,
        firstName: firstName!,
        lastName: lastName!,
        orgRoleId: orgRoleId!,
      },
    },
  ];
  if (candidateId && scimProvider) {
    payload[0].scim = { candidateId, providerId: scimProvider.id };
  }

  const res = await dispatch({
    type: Client.ActionType.INVITE_USERS,
    payload,
  });

  await logAndExitIfActionFailed(res, "Invitation failed.");

  state = res.state;

  const [{ identityHash, encryptionKey, user }] = state.generatedInvites;
  if (!identityHash || !encryptionKey) {
    return exit(
      1,
      "Invitation failed. " + JSON.stringify(state.generatedInvites)
    );
  }
  const outOfBandEncToken = [identityHash, encryptionKey].join("_");
  clipboardy.writeSync(outOfBandEncToken);
  console.log(
    `\nAn EnvKey invitation has been sent to ${firstName} by email.\nYou also need to send ${firstName} an ${chalk.bold(
      "Encryption Token"
    )} by any reasonably private channel (like Slack, Twitter, Skype, or Facebook). It was ${chalk.bold(
      "just copied"
    )} to your system's clipboard.`
  );
  console.log("  ", outOfBandEncToken);

  const hasNoDefaultApps = !(state.graph[orgRoleId] as OrgRole).autoAppRoleId;
  if (hasNoDefaultApps) {
    console.log(
      chalk.italic(
        `${firstName} doesn't have access to any apps yet. Use ${chalk.bold(
          "envkey apps grant-access"
        )} to give them access.`
      )
    );
  }

  autoModeOut({
    orgUserId: user.id,
    orgRoleId,
    encryptionToken: outOfBandEncToken,
  });

  return exit();
};

const expectedInputFormat = JSON.stringify(
  [
    {
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@example.com",
      role: "Basic User    or    Org Admin    or     Org Owner",
    },
  ],
  null,
  2
);

const doBulkJsonEmailImportOrBust = async (
  graph: Graph.UserGraph,
  userId: string,
  jsonFilePath: string
) => {
  let payload:
    | Pick<Api.Net.ApiParamTypes["CreateInvite"], "user">[]
    | undefined;

  try {
    const initialImport = JSON.parse(
      fs.readFileSync(jsonFilePath, { encoding: "utf8" })
    ) as z.infer<typeof JsonUserInviteSchema>;
    JsonUserInviteSchema.parse(initialImport);
    payload = initialImport.map(({ firstName, lastName, email, role }) => ({
      user: {
        provider: "email",
        email: email,
        uid: email,
        firstName,
        lastName,
        orgRoleId: findOrgRoleId(graph, userId, role),
      },
    }));
    console.log(`Generating ${payload.length} secure invitations...`);
  } catch (err) {
    console.error(err);
    return exit(
      1,
      err +
        "Expected user list from JSON in the following format:\n" +
        expectedInputFormat
    );
  }

  let numGeneratedInvites = 0;

  // to work around some issues with timed-out transactions, only sending a few at a time
  let table = new Table({
    colWidths: [30, 84],
    head: ["User", "Encryption Token"],
    style: {
      head: [], //disable colors in header cells
    },
  });
  console.log(table.toString());
  while (payload.length) {
    const toInvite = payload.splice(0, 20);
    const res = await dispatch({
      type: Client.ActionType.INVITE_USERS,
      payload: toInvite,
    });

    const logUsers = toInvite.map((i) => i.user.email).join("\n");
    await logAndExitIfActionFailed(
      res,
      `Failed to invite these users:\n${logUsers}`
    );
    table = new Table({
      colWidths: [30, 84],
    });
    for (const { identityHash, encryptionKey, user } of res.state
      .generatedInvites) {
      const outOfBandEncToken = [identityHash, encryptionKey].join("_");
      table.push([
        user.firstName + " " + user.lastName + "\n" + user.email,
        chalk.blueBright.bgBlack.bold(outOfBandEncToken),
      ]);
    }
    console.log(table.toString());
  }

  console.log(
    `\n${numGeneratedInvites} EnvKey invitations have been sent by email.\nYou also need to send each user an ${chalk.bold(
      "Encryption Token"
    )} by any reasonably private channel (like Slack, Twitter, Skype, or Facebook).`
  );
};

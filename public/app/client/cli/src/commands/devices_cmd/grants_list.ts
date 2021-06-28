import { exit } from "../../lib/process";
import { Model } from "@core/types";
import { initCore } from "../../lib/core";
import { Argv } from "yargs";
import { BaseArgs } from "../../types";
import chalk from "chalk";
import Table from "cli-table3";
import { graphTypes, authz } from "@core/lib/graph";
import * as R from "ramda";
import { autoModeOut } from "../../lib/console_io";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["pending", "grants"];
export const desc = "List pending device grants.";
export const builder = (yargs: Argv<BaseArgs>) => yargs;
export const handler = async (argv: BaseArgs): Promise<void> => {
  let { state, auth } = await initCore(argv, true);
  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }

  const table = new Table({
    head: ["Created By", "For", "At", "Grant ID (for revocation)"],
    style: {
      head: [], //disable colors in header cells
    },
  });
  console.log(
    chalk.bold(
      `There are ${
        graphTypes(state.graph).deviceGrants.length
      } device grants pending:`
    )
  );

  const deviceGrants = graphTypes(state.graph).deviceGrants;
  for (let deviceGrant of deviceGrants) {
    const createdBy = state.graph[deviceGrant.grantedByUserId] as Model.OrgUser;
    const createdFor = state.graph[deviceGrant.granteeId] as Model.OrgUser;
    table.push([
      chalk.bold(
        `${createdBy.email} - ${createdBy.firstName} ${createdBy.lastName}`
      ),
      chalk.bold(
        `${createdFor.email} - ${createdFor.firstName} ${createdFor.lastName}`
      ),
      `${new Date(deviceGrant.createdAt).toUTCString()} UTC`,
      authz.canRevokeDeviceGrant(
        state.graph,
        auth.userId,
        deviceGrant.id,
        Date.now()
      )
        ? chalk.bold(deviceGrant.id)
        : chalk.red("<no permission>"),
    ]);
  }

  console.log(table.toString(), "\n");
  autoModeOut({
    grants: deviceGrants.map((dg) =>
      R.pick(["id", "granteeId", "grantedByUserId"], dg)
    ),
  });
  return exit();
};

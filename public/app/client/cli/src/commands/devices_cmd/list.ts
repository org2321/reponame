import { exit } from "../../lib/process";
import chalk from "chalk";
import { initCore } from "../../lib/core";
import { graphTypes } from "@core/lib/graph";
import { Argv } from "yargs";
import { BaseArgs } from "../../types";
import Table from "cli-table3";
import { Model } from "@core/types";
import { autoModeOut } from "../../lib/console_io";
import * as R from "ramda";
import { tryApplyEnvkeyOverride } from "../../envkey_detection";

export const command = ["list", "ls"];
export const desc = "List active devices for the account";
export const builder = (yargs: Argv<BaseArgs>) => yargs;
export const handler = async (argv: BaseArgs): Promise<void> => {
  let { state, auth } = await initCore(argv, true);
  // override account from ENVKEY
  if (tryApplyEnvkeyOverride(auth.userId, argv)) {
    return handler(argv);
  }
  // TODO: list other user devices
  const devices = graphTypes(state.graph).orgUserDevices.filter(
    (d) => d.userId === auth.userId
  );
  if (!devices.length) {
    return exit(1, "There are no devices for this account.");
  }
  const table = new Table({
    style: {
      head: [], //disable colors in header cells
    },
    head: ["Device Name", "User", "Added", "Device Type", "Device ID"],
  });
  for (let d of devices) {
    const user = state.graph[d.userId] as Model.OrgUser;
    table.push([
      chalk.bold(d.name),
      [user?.firstName, user?.lastName].join(" "),
      d.createdAt,
      d.type,
      d.id,
    ]);
  }
  console.log(table.toString());
  autoModeOut({
    devices: devices.map((d) => ({
      ...R.pick(["id", "userId"], d),
      email: (state.graph[d.userId] as Model.OrgUser)?.email,
    })),
  });

  return exit();
};

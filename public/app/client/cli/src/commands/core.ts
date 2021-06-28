import { Argv } from "yargs";
import { addCommand } from "../cmd";
import { BaseArgs } from "../types";

import * as restart from "./core_cmd/restart";
import * as start from "./core_cmd/start";
import * as status from "./core_cmd/status";
import * as stop from "./core_cmd/stop";
import * as completion from "./core_cmd/completion";

addCommand((yargs: Argv<BaseArgs>) =>
  yargs.command(
    ["core <command>"],
    "Local Background Process",
    (yargs) =>
      yargs
        .command(restart)
        .command(start)
        .command(status)
        .command(stop)
        .command(completion)
        .demandCommand() // invalid sub-commands will hang without this
  )
);

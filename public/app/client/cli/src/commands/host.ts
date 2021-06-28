import { Argv } from "yargs";
import { addCommand } from "../cmd";
import { BaseArgs } from "../types";

import * as destroy from "./host_cmd/host_destroy";
import * as azs from "./host_cmd/availability_zones";

addCommand((yargs: Argv<BaseArgs>) =>
  yargs.command(
    "host <command>",
    "Self-Hosting Utilities",
    (yargs) =>
      yargs
        .command(azs)
        .command(destroy)
        .demandCommand() // invalid sub-commands will hang without this
  )
);

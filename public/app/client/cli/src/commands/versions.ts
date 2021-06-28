import { Argv } from "yargs";
import { addCommand } from "../cmd";
import { BaseArgs } from "../types";

import * as list from "./versions_cmd/versions_list";
import * as revert from "./versions_cmd/versions_revert";
import * as inspect from "./versions_cmd/versions_inspect";
import * as inspectCommit from "./versions_cmd/versions_inspect_commit";

addCommand((yargs: Argv<BaseArgs>) =>
  yargs.command(
    // singular `version` unavailable because it conflicts with `--version` and `version` of the whole CLI
    ["versions <command>"],
    "Environment Versions and Rollback",
    (yargs) =>
      yargs
        .command(list)
        .command(inspect)
        .command(inspectCommit)
        .command(revert)
        .demandCommand() // invalid sub-commands will hang without this
  )
);

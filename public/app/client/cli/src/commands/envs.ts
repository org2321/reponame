import { Argv } from "yargs";
import { addCommand } from "../cmd";
import { BaseArgs } from "../types";

import * as setCmd from "./envs_cmd/set";
import * as show from "./envs_cmd/show";
import * as pending from "./envs_cmd/pending";
import * as reset from "./envs_cmd/reset";
import * as commit from "./envs_cmd/commit";
import * as importCmd from "./envs_cmd/import";
import * as exportCmd from "./envs_cmd/export";
import * as list from "./envs_cmd/envs_list";
import * as createSub from "./envs_cmd/create_sub";
import * as deleteSub from "./envs_cmd/delete_sub";

addCommand((yargs: Argv<BaseArgs>) =>
  yargs.command(
    ["environments <command>", "environment <command>", "envs <command>"],
    "Manage Environment Variables",
    (yargs) =>
      yargs
        .command(setCmd)
        .command(show)
        .command(pending)
        .command(reset)
        .command(commit)
        .command(importCmd)
        .command(exportCmd)
        .command(list)
        .command(createSub)
        .command(deleteSub)
        .demandCommand() // invalid sub-commands will hang without this
  )
);

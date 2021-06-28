import { Argv } from "yargs";
import { addCommand } from "../cmd";
import { BaseArgs } from "../types";

import * as list from "./localkeys_cmd/list";
import * as create from "./localkeys_cmd/create";
import * as del from "./localkeys_cmd/delete";
import * as renew from "./localkeys_cmd/renew";
import * as revoke from "./localkeys_cmd/revoke";

addCommand((yargs: Argv<BaseArgs>) =>
  yargs.command(
    ["local-keys <command>", "local-key <command>"],
    "Local Development ENVKEYs",
    (yargs) =>
      yargs
        .command(list)
        .command(create)
        .command(del)
        .command(renew)
        .command(revoke)
        .demandCommand() // invalid sub-commands will hang without this
  )
);

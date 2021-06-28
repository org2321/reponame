import { Argv } from "yargs";
import { addCommand } from "../cmd";
import { BaseArgs } from "../types";

import * as list from "./serverkeys_cmd/list";
import * as create from "./serverkeys_cmd/create";
import * as del from "./serverkeys_cmd/delete";
import * as renew from "./serverkeys_cmd/renew";
import * as revoke from "./serverkeys_cmd/revoke";

addCommand((yargs: Argv<BaseArgs>) =>
  yargs.command(
    ["servers <command>", "server-keys <command>", "server <command>"],
    "Server ENVKEYs (for deployments)",
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

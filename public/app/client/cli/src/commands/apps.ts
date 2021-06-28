import { Argv } from "yargs";
import { addCommand } from "../cmd";
import { BaseArgs } from "../types";

import * as list from "./apps_cmd/list";
import * as create from "./apps_cmd/create";
import * as del from "./apps_cmd/delete";
import * as grant from "./apps_cmd/access_grant";
import * as revoke from "./apps_cmd/access_revoke";
import * as listCollaborators from "./apps_cmd/list_collaborators";
import * as accessUpdate from "./apps_cmd/access_update";
// import * as current from "./apps_cmd/current";

addCommand((yargs: Argv<BaseArgs>) =>
  yargs.command(
    ["apps <command>", "app <command>"],
    "Apps and App Access",
    (yargs) =>
      yargs
        .command(list)
        .command(create)
        .command(del)
        .command(grant)
        .command(revoke)
        .command(listCollaborators)
        .command(accessUpdate)
        // .command(current)
        .demandCommand() // invalid sub-commands will hang without this
  )
);

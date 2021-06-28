import { Argv } from "yargs";
import { addCommand } from "../cmd";
import { BaseArgs } from "../types";

import * as envRoles from "./rbac_cmd/environment_roles";
import * as orgRoles from "./rbac_cmd/org_roles";

addCommand((yargs: Argv<BaseArgs>) =>
  yargs.command(
    ["rbac <command>", "rbac <command>"],
    "Role Based Access Control",
    (yargs) =>
      yargs
        .command(orgRoles)
        .command(envRoles)
        .demandCommand() // invalid sub-commands will hang without this
  )
);

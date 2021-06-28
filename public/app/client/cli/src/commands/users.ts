import { Argv } from "yargs";
import { addCommand } from "../cmd";
import { BaseArgs } from "../types";

import * as invite from "./users_cmd/invite";
import * as list from "./users_cmd/list";
import * as revokeInvite from "./users_cmd/revoke";
import * as del from "./users_cmd/delete";
import * as updateRole from "./users_cmd/update_role";

addCommand((yargs: Argv<BaseArgs>) =>
  yargs.command(
    ["users <command>", "user <command>"],
    "Users and Invites",
    (yargs) => yargs
      .command(invite)
      .command(list)
      .command(revokeInvite)
      .command(del)
      .command(updateRole)
      .demandCommand() // invalid sub-commands will hang without this
  )
);

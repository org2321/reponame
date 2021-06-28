import { Argv } from "yargs";
import { addCommand } from "../cmd";
import { BaseArgs } from "../types";

import * as settings from "./org_cmd/org_settings";
import * as del from "./org_cmd/org_delete";
import * as requireLockout from "./org_cmd/org_settings_require_lockout";
import * as requirePass from "./org_cmd/org_settings_require_passphrase";

import * as samlSetup from "./org_cmd/saml_setup";
import * as samlStatus from "./org_cmd/saml_status";
import * as samlUpdate from "./org_cmd/saml_update";
import * as samlDelete from "./org_cmd/saml_delete";

import * as scimSetup from "./org_cmd/scim_setup";
import * as scimInfo from "./org_cmd/scim_info";
import * as scimUpdate from "./org_cmd/scim_update";
import * as scimDelete from "./org_cmd/scim_delete";

addCommand((yargs: Argv<BaseArgs>) =>
  yargs.command(
    ["org <command>"],
    "Organization Settings and SSO",
    (yargs) => yargs
      .command(settings)
      .command(requireLockout)
      .command(requirePass)
      .command(samlStatus)
      .command(samlSetup)
      .command(samlUpdate)
      .command(samlDelete)
      .command(scimInfo)
      .command(scimSetup)
      .command(scimUpdate)
      .command(scimDelete)
      .command(del)
      .demandCommand() // invalid sub-commands will hang without this
  )
);

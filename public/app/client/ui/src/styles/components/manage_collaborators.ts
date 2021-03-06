import { style } from "typestyle";
import * as colors from "../colors";
import * as fonts from "../fonts";
import { listItem } from "../mixins";
import { AssocManagerContainer } from "./assoc_manager_container";

export const ManageCollaborators =
  AssocManagerContainer +
  " " +
  style({
    $nest: {
      ".buttons": {
        marginBottom: 30,
      },
    },
  });

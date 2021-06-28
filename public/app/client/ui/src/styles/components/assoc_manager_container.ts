import { style } from "typestyle";
import { multi } from "../helpers";
import * as colors from "../colors";
import * as fonts from "../fonts";
import { listItem } from "../mixins";
import { OrgContainer } from "./org_container";

export const AssocManagerContainer =
  OrgContainer +
  " " +
  style({
    $nest: {
      ".assoc-list": {
        width: "100%",
        $nest: {
          "& > div": listItem(),
        },
      },
    },
  });

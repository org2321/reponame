import { style } from "typestyle";
import * as colors from "../colors";
import * as fonts from "../fonts";
import { multi } from "../helpers";
import { listItem } from "../mixins";
import { GeneratedInvites } from "./invites";

export const Devices =
  GeneratedInvites +
  " " +
  style({
    $nest: {
      ...multi(
        [
          ".authorized-devices",
          ".pending-device-grants",
          ".expired-device-grants",
        ],
        {
          width: "100%",
          $nest: {
            "> div": listItem(),
          },
        }
      ),
      ".billing-wall": {
        borderTop: "1px solid rgba(0,0,0,0.1)",
        paddingTop: 30,
        marginTop: 20,
      },
    },
  });

import { style } from "typestyle";
import * as colors from "../../colors";
import * as fonts from "../../fonts";
import { HomeContainerForm } from "./home_container";

export const Register =
  HomeContainerForm +
  " " +
  style({
    $nest: {
      "div > span": {
        color: "#aaa",
      },
      "div > span strong": {
        color: "#bbb",
      },
    }
  });

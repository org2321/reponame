import { style } from "typestyle";
import * as colors from "../colors";
import * as fonts from "../fonts";
import { listItem } from "../mixins";
import { OrgContainer } from "./org_container";

export const InviteUsers =
  OrgContainer +
  " " +
  style({
    $nest: {
      ".pending-invites": {
        marginBottom: 30,
      },
      ".pending": listItem(),
    },
  });

export const GeneratedInvites =
  OrgContainer +
  " " +
  style({
    $nest: {
      ".generated-invites": {
        width: "100%",
        marginBottom: 20,
        $nest: {
          "> div": {
            background: colors.DARK_BLUE,
            marginBottom: 20,
            padding: 20,
            width: "100%",
            position: "relative",

            $nest: {
              ".name": {
                marginBottom: 15,
                $nest: {
                  label: {
                    color: "rgba(255,255,255,0.8)",
                    fontSize: "18px",
                    $nest: {
                      strong: {
                        color: "#fff",
                        fontSize: "20px",
                      },
                    },
                  },
                },
              },

              ".token": {
                width: "100%",
                $nest: {
                  "> div": {
                    display: "flex",
                    width: "100%",
                  },
                  label: {
                    display: "block",
                    fontFamily: fonts.CONDENSED,
                    textTransform: "uppercase",
                    fontWeight: 400,
                    fontSize: "16px",
                    color: "rgba(255,255,255,0.85)",
                    marginBottom: 10,
                  },
                  span: {
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: colors.DARKER_BLUE,
                    marginRight: 20,
                    fontFamily: fonts.CODE,
                    color: colors.LIGHTEST_BLUE, //"rgba(0,0,0,0.3)",
                    fontWeight: 500,
                    position: "relative",
                  },
                },
              },

              small: {
                color: "rgba(0,0,0,0.6)",
                position: "absolute",
                top: "50%",
                right: 15,
                fontSize: "13px",
                fontWeight: 500,
                transform: "translateY(-50%)",
              },

              button: {
                border: "1px solid rgba(255,255,255,0.7)",
                background: "none",
                color: "rgba(255,255,255,0.9)",
                fontFamily: fonts.CONDENSED,
                textTransform: "uppercase",
                fontWeight: 500,
                borderRadius: 2,
                padding: "5px 10px",
                cursor: "pointer",
              },
            },
          },
        },
      },
    },
  });

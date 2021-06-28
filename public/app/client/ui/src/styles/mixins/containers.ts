import * as fonts from "../fonts";
import * as colors from "../colors";
import * as R from "ramda";
import { types } from "typestyle";
import {
  primaryButton,
  secondaryButton,
  tertiaryButton,
  backLink,
} from "./buttons";
import { deepMergeStyles, multi } from "../helpers";
import { customSelect } from "./select";

export const baseContainer = (params: {
  width: number;
  bgMode: "light" | "dark";
  hAlign?: "start" | "center";
}): types.NestedCSSProperties => {
  return {
    width: params.width,
    display: "flex",
    flexDirection: "column",
    alignItems: params.hAlign ?? "center",
    textAlign: "left",
    $nest: {
      ...[
        multi(["textarea", "input:not([type=submit])"], {
          border:
            params.bgMode == "dark"
              ? "1px solid rgba(0,0,0,0.1)"
              : "1px solid rgba(0,0,0,0.2)",
        }),
        multi(["textarea:focus", "input:not([type=submit]):focus"], {
          border: `1px solid ${colors.LIGHT_ORANGE}`,
          boxShadow: `0 0 1px 1px ${colors.LIGHT_ORANGE}`,
        }),

        multi(
          [
            "input:not([type])",
            "input[type=text]",
            "input[type=email]",
            "input[type=password]",
            "input[type=number]",
            "textarea",
          ],
          {
            fontSize: "16px",
            display: "inline-block",
            width: "100%",
            padding: 10,
            borderRadius: "2px",

            $nest: {
              "&[disabled]": {
                background: params.bgMode == "dark" ? "#bbb" : "#eee",
              },
            },
          }
        ),
      ].reduce(R.mergeDeepRight, {}),

      ...multi(
        [
          "input:not(:last-child)",
          ".select:not(:last-child)",
          "textarea:not(:last-child)",
        ],
        {
          marginBottom: 15,
        }
      ),

      ".select": deepMergeStyles(
        customSelect(
          params.bgMode == "dark" ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
          15
        ),
        {
          border:
            params.bgMode == "dark"
              ? "1px solid rgba(255,255,255,0.2)"
              : "1px solid rgba(0,0,0,0.2)",
          cursor: "pointer",
          $nest: {
            "> select": {
              color:
                params.bgMode == "dark"
                  ? "rgba(255,255,255,0.6)"
                  : "rgba(0,0,0,0.6)",
              padding: 10,
              $nest: {
                "&[disabled]": {
                  background:
                    params.bgMode == "dark"
                      ? "rgba(255,255,255,0.1)"
                      : "rgba(0,0,0,0.1)",
                },
              },
            },
            "&:hover": {
              background:
                params.bgMode == "dark"
                  ? "rgba(255,255,255,0.02)"
                  : "rgba(0,0,0,0.02)",
              $nest: {
                svg: {
                  fill:
                    params.bgMode == "dark"
                      ? "rgba(255,255,255,0.4)"
                      : "rgba(0,0,0,0.4)",
                },
              },
            },
          },
        }
      ),

      "input[type=checkbox]": {
        transform: "scale(1.25)",
      },

      ...multi(
        ["button.primary", "input[type=submit].primary", "a.primary"],
        primaryButton({
          bgMode: params.bgMode,
        })
      ),

      ...multi(
        ["button.secondary", "input[type=submit].secondary", "a.secondary"],
        secondaryButton({ bgMode: params.bgMode })
      ),

      ...multi(
        ["button.tertiary", "input[type=submit].tertiary", "a.tertiary"],
        tertiaryButton({ bgMode: params.bgMode })
      ),

      ".back-link": {
        marginTop: 40,
        textAlign: "center",
        $nest: {
          a: backLink({ bgMode: params.bgMode, fontSize: "16px" }),
        },
      },

      ".buttons": {
        width: params.width,
        display: "flex",
        $nest: {
          "> *": {
            flex: 1,
          },
          "> *:not(:last-child)": {
            marginRight: 15,
          },
        },
      },

      ".field": {
        width: params.width,
        marginBottom: 40,
      },

      ".field > .primary": {
        width: "100%",
      },

      ".field.checkbox": {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        cursor: "pointer",
        padding: 20,
        border: `1px solid ${
          params.bgMode == "dark" ? "rgba(0,0,0,0.9)" : "rgba(0,0,0,0.15)"
        }`,
        borderRadius: "2px",

        $nest: {
          "*": {
            cursor: "pointer",
          },
          "&:not([disabled]):hover": {
            background:
              params.bgMode == "dark"
                ? "rgba(255,255,255,0.02)"
                : "rgba(0,0,0,0.02)",
            border: `1px solid ${
              params.bgMode == "dark" ? "#000" : "rgba(0,0,0,0.2)"
            }`,
          },
          "&.selected": {
            background:
              params.bgMode == "dark"
                ? "rgba(255,255,255,0.04)"
                : "rgba(0,0,0,0.04)",
          },
          "&.disabled": {
            opacity: 0.6,
          },
        },
      },

      ".field.radio-group > div": {
        display: "flex",
        alignItems: "center",
        width: "100%",
        $nest: {
          label: {
            flex: 1,
            cursor: "pointer",
            padding: 15,
            border: "1px solid rgba(0,0,0,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            $nest: {
              "&:first-of-type": {
                borderRight: "none",
              },
              "&.selected": {
                background: "rgba(0,0,0,0.03)",
                $nest: {
                  span: {
                    color: colors.DARKER_BLUE,
                  },
                },
              },
              "&:not(.selected):hover": {
                background: "rgba(0,0,0,0.015)",
              },
              input: {
                transform: "scale(1.25)",
                margin: 0,
              },
              span: {
                fontFamily: fonts.CONDENSED,
                fontSize: "16px",
                textTransform: "uppercase",
                color: "rgba(0,0,0,0.5)",
              },
            },
          },
        },
      },

      ".field > label": {
        color:
          params.bgMode == "dark" ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.4)",
        $nest: {
          ...multi(["&", "& *"], {
            fontFamily: fonts.CONDENSED,
            fontWeight: params.bgMode == "dark" ? 300 : 400,
            fontSize: "18px",
            textTransform: "uppercase",
          }),
          strong: {
            color:
              params.bgMode == "dark" ? colors.LIGHTEST_BLUE : colors.DARK_BLUE,
          },
        },
      },

      ".field .sep": {
        color: "rgba(0,0,0,0.3)",
        margin: "0 7px",
      },

      ".field:not(.checkbox) > label": {
        display: "block",
        marginBottom: 20,
      },

      ".field.empty-placeholder": {
        marginBottom: 20,
        $nest: {
          span: {
            marginLeft: 10,
            color: "rgba(0,0,0,0.4)",
          },
        },
      },

      p: {
        width: params.width,
        marginTop: 0,
        marginBottom: 30,
        textAlign: "left",
        $nest: {
          ...multi(["&", "& *"], {
            color:
              params.bgMode == "dark"
                ? "rgba(255,255,255,0.9)"
                : colors.DARK_TEXT,
            fontSize: "18px",
          }),
          strong: {
            fontWeight: 500,
            color:
              params.bgMode == "dark" ? colors.LIGHTEST_BLUE : colors.DARK_BLUE,
          },
          em: {
            fontWeight: 500,
            fontStyle: "normal",
            color:
              params.bgMode == "dark" ? colors.LIGHT_ORANGE : colors.ORANGE,
          },

          code: {
            fontWeight: 500,
            fontFamily: fonts.CODE,
            fontSize: "16px",
            padding: "3px 6px",
            background: colors.OFF_BLACK,
            color: "#fff",
          },

          "&.important": {
            padding: 20,
            background: colors.DARKER_BLUE,
            color: "#fff",
            fontWeight: 400,
            $nest: {
              h4: {
                color: "rgba(0,0,0,0.55)",
                background: "none",
                padding: 0,
                fontFamily: fonts.CONDENSED,
                marginBottom: 10,
                paddingBottom: 10,
                borderBottom: "1px solid rgba(0,0,0,0.2)",
                textAlign: "center",
                fontSize: "20px",
                textTransform: "uppercase",
              },
            },
          },
        },
      },

      h3: {
        width: params.width,
        textAlign: "center",
      },

      ".error": {
        color: "#fff",
        padding: "10px 15px",
        background: colors.RED,
        $nest: {
          strong: {
            color: "#fff",
          },
        },
      },
    },
  };
};

export const hoverable = (
  bg: string,
  hoverBg: string,
  $nest?: types.NestedCSSProperties["$nest"],
  cursor?: string,
  allowUserSelect?: true
): types.NestedCSSProperties => ({
  userSelect: allowUserSelect ? "inherit" : "none",
  background: bg,
  $nest: {
    ...multi(["&", "& *"], {
      cursor: cursor ?? "pointer",
    }),
    "&:hover": {
      background: hoverBg,

      ...($nest ? { $nest } : {}),
    },
  },
});

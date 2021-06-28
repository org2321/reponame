import * as fonts from "../fonts";
import * as colors from "../colors";
import { color } from "csx";
import { types } from "typestyle";
import { deepMergeStyles, multi } from "../helpers";

export const button = (
  params: {
    width?: number | string;
  } = {}
): types.NestedCSSProperties => ({
  fontSize: "18px",
  fontFamily: fonts.CONDENSED,
  textTransform: "uppercase",
  borderRadius: "2px",
  border: "none",
  display: "inline-block",
  width: params.width,
  padding: 10,
  cursor: "pointer",
  textAlign: "center",
  $nest: {
    ...multi(["&[disabled]", "&.disabled"], {
      cursor: "not-allowed",
      opacity: 0.7,
    }),
  },
});

const primaryButtonActiveBg = color(colors.ORANGE).darken(0.05).toHexString();

export const primaryButton = (params: {
  width?: number | string;
  bgMode: "light" | "dark";
}): types.NestedCSSProperties =>
  deepMergeStyles(button(params), {
    color: "#fff",
    background: colors.ORANGE,
    border: "1px solid rgba(0,0,0,0.0)",
    $nest: {
      "&:not([disabled]):not(.disabled):hover": {
        background: primaryButtonActiveBg,
      },
      "&:not([disabled]):not(.disabled):focus": {
        background: primaryButtonActiveBg,
        border: `1px solid ${colors.LIGHT_ORANGE}`,
        boxShadow: `0 0 1px 1px ${colors.LIGHT_ORANGE}`,
      },
    },
  });

export const secondaryButton = (params: {
  width?: number | string;
  bgMode: "light" | "dark";
}): types.NestedCSSProperties =>
  deepMergeStyles(button(params), {
    background:
      params.bgMode == "dark" ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.1)",
    color: "rgba(0,0,0,0.6)",
    $nest: {
      "&:not([disabled]):not(.disabled):hover": {
        background:
          params.bgMode == "dark"
            ? "rgba(255,255,255,0.4)"
            : "rgba(0,0,0,0.15)",
      },
    },
  });

export const tertiaryButton = (params: {
  width?: number | string;
  bgMode: "light" | "dark";
}): types.NestedCSSProperties =>
  deepMergeStyles(button(params), {
    background:
      params.bgMode == "light" ? colors.DARKER_BLUE : colors.LIGHT_BLUE,
    color: "#fff",
    $nest: {
      "&:not([disabled]):not(.disabled):hover": {
        background:
          params.bgMode == "light"
            ? color(colors.DARKER_BLUE).darken(0.05).toHexString()
            : color(colors.LIGHT_BLUE).darken(0.05).toHexString(),
      },
    },
  });

export const backLink = (params: {
  bgMode: "light" | "dark";
  fontSize?: string;
}): types.NestedCSSProperties => ({
  color: params.bgMode == "dark" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.6)",
  fontFamily: fonts.CONDENSED,
  fontSize: params.fontSize ?? "15px",
  textTransform: "uppercase",
  display: "inline-block",
  padding: "0 20px 20px 20px",
  cursor: "pointer",
  $nest: {
    "&:hover": {
      color: params.bgMode == "dark" ? "#fff" : "rgba(0,0,0,0.6)",
      borderBottom: `1px solid ${
        params.bgMode == "dark" ? colors.LIGHTEST_BLUE : colors.DARK_BLUE
      }`,
    },
  },
});

export const imgLink = (params: {
  bgMode: "light" | "dark";
  fontSize?: string;
}): types.NestedCSSProperties => ({
  display: "flex",
  alignItems: "center",
  color: params.bgMode == "dark" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.4)",
  padding: "0 15px 27.5px",
  fontSize: params.fontSize ?? "13.5px",
  borderBottom: `1px solid transparent`,
  $nest: {
    "> svg": {
      width: 15,
      height: 15,
      fill: "rgba(255,255,255,0.4)",
      marginRight: 8,
    },
    "&:hover": {
      color: "rgba(255,255,255,0.9)",
      borderBottom: `1px solid ${colors.LIGHTEST_BLUE}`,
      $nest: {
        "> svg": {
          fill: "rgba(255,255,255,0.7)",
        },
      },
    },
  },
});

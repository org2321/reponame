import React from "react";

const FONTS = {
  "nimbus-sans-novus": {
    "200": "nimbus-sans-novus-light",
    "300": "nimbus-sans-novus-regular",
    "400": "nimbus-sans-novus-medium",
    "500": "nimbus-sans-novus-semibold",
  },
  "nimbus-sans-novus-condensed": {
    "200": "nimbus-sans-novus-cond-light",
    "300": "nimbus-sans-novus-cond-regular",
    "400": "nimbus-sans-novus-cond-medium",
    "500": "nimbus-sans-novus-cond-semibold",
    "600": "nimbus-sans-novus-cond-bold",
  },
};
const FORMATS = ["woff", "woff2", "eot", "ttf"];

export const FontFaces = () => {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
            ${Object.entries(FONTS)
              .flatMap(([family, byWeight]) =>
                Object.entries(byWeight).map(
                  ([weight, path]) => `
                @font-face {
                  font-family: '${family}';
                  src: ${FORMATS.map(
                    (ext) =>
                      `url(${
                        FONT_REQUIRES[[path, ext].join("-")]
                      }) format('${ext}')`
                  ).join(", ")};                  
                  font-weight: ${weight};
                  font-style: normal;
                  font-display: block;
                }
              `
                )
              )
              .join("\n")}
          `,
      }}
    />
  );
};

// static requires to ensure that webpack includes all the fonts we need
const FONT_REQUIRES: Record<string, string> = {
  "nimbus-sans-novus-light-woff": require("../fonts/nimbus-sans-novus-light.woff")
    .default,
  "nimbus-sans-novus-light-woff2": require("../fonts/nimbus-sans-novus-light.woff2")
    .default,
  "nimbus-sans-novus-light-eot": require("../fonts/nimbus-sans-novus-light.eot")
    .default,
  "nimbus-sans-novus-light-ttf": require("../fonts/nimbus-sans-novus-light.ttf")
    .default,

  "nimbus-sans-novus-medium-woff": require("../fonts/nimbus-sans-novus-medium.woff")
    .default,
  "nimbus-sans-novus-medium-woff2": require("../fonts/nimbus-sans-novus-medium.woff2")
    .default,
  "nimbus-sans-novus-medium-eot": require("../fonts/nimbus-sans-novus-medium.eot")
    .default,
  "nimbus-sans-novus-medium-ttf": require("../fonts/nimbus-sans-novus-medium.ttf")
    .default,

  "nimbus-sans-novus-regular-woff": require("../fonts/nimbus-sans-novus-regular.woff")
    .default,
  "nimbus-sans-novus-regular-woff2": require("../fonts/nimbus-sans-novus-regular.woff2")
    .default,
  "nimbus-sans-novus-regular-eot": require("../fonts/nimbus-sans-novus-regular.eot")
    .default,
  "nimbus-sans-novus-regular-ttf": require("../fonts/nimbus-sans-novus-regular.ttf")
    .default,

  "nimbus-sans-novus-semibold-woff": require("../fonts/nimbus-sans-novus-semibold.woff")
    .default,
  "nimbus-sans-novus-semibold-woff2": require("../fonts/nimbus-sans-novus-semibold.woff2")
    .default,
  "nimbus-sans-novus-semibold-eot": require("../fonts/nimbus-sans-novus-semibold.eot")
    .default,
  "nimbus-sans-novus-semibold-ttf": require("../fonts/nimbus-sans-novus-semibold.ttf")
    .default,

  "nimbus-sans-novus-cond-light-woff": require("../fonts/nimbus-sans-novus-cond-light.woff")
    .default,
  "nimbus-sans-novus-cond-light-woff2": require("../fonts/nimbus-sans-novus-cond-light.woff2")
    .default,
  "nimbus-sans-novus-cond-light-eot": require("../fonts/nimbus-sans-novus-cond-light.eot")
    .default,
  "nimbus-sans-novus-cond-light-ttf": require("../fonts/nimbus-sans-novus-cond-light.ttf")
    .default,

  "nimbus-sans-novus-cond-medium-woff": require("../fonts/nimbus-sans-novus-cond-medium.woff")
    .default,
  "nimbus-sans-novus-cond-medium-woff2": require("../fonts/nimbus-sans-novus-cond-medium.woff2")
    .default,
  "nimbus-sans-novus-cond-medium-eot": require("../fonts/nimbus-sans-novus-cond-medium.eot")
    .default,
  "nimbus-sans-novus-cond-medium-ttf": require("../fonts/nimbus-sans-novus-cond-medium.ttf")
    .default,

  "nimbus-sans-novus-cond-regular-woff": require("../fonts/nimbus-sans-novus-cond-regular.woff")
    .default,
  "nimbus-sans-novus-cond-regular-woff2": require("../fonts/nimbus-sans-novus-cond-regular.woff2")
    .default,
  "nimbus-sans-novus-cond-regular-eot": require("../fonts/nimbus-sans-novus-cond-regular.eot")
    .default,
  "nimbus-sans-novus-cond-regular-ttf": require("../fonts/nimbus-sans-novus-cond-regular.ttf")
    .default,

  "nimbus-sans-novus-cond-semibold-woff": require("../fonts/nimbus-sans-novus-cond-semibold.woff")
    .default,
  "nimbus-sans-novus-cond-semibold-woff2": require("../fonts/nimbus-sans-novus-cond-semibold.woff2")
    .default,
  "nimbus-sans-novus-cond-semibold-eot": require("../fonts/nimbus-sans-novus-cond-semibold.eot")
    .default,
  "nimbus-sans-novus-cond-semibold-ttf": require("../fonts/nimbus-sans-novus-cond-semibold.ttf")
    .default,

  "nimbus-sans-novus-cond-bold-woff": require("../fonts/nimbus-sans-novus-cond-bold.woff")
    .default,
  "nimbus-sans-novus-cond-bold-woff2": require("../fonts/nimbus-sans-novus-cond-bold.woff2")
    .default,
  "nimbus-sans-novus-cond-bold-eot": require("../fonts/nimbus-sans-novus-cond-bold.eot")
    .default,
  "nimbus-sans-novus-cond-bold-ttf": require("../fonts/nimbus-sans-novus-cond-bold.ttf")
    .default,
};

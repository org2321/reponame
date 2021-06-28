import React from "react";
import * as fonts from "./fonts";
import * as colors from "./colors";

export const BaseStyles = () => {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `            
            html, body {
              overflow-x: hidden;              
            }
            html.loaded {
              background: #fff;
            }
            body, body * {
              font-family: ${fonts.MAIN};
              color: ${colors.DARK_TEXT};
              outline-style: none;
              line-height: 1.5;
            }
            ul {
              list-style: none;
              margin: 0;
              padding: 0;
            }
            a, a:visited {
              text-decoration: none;
              color: inherit;
            }
            h1, h2, h3, h4, h5, h6 {
              margin: 0;
              padding: 0;
            }
            h1, h2, h3, h4, h5, h6, a, button, label, strong, small, p, span, svg, img {
              user-select: none;
            }
          `,
      }}
    />
  );
};

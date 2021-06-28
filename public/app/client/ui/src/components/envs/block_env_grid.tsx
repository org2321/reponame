import React from "react";
import { EnvManagerComponent } from "@ui_types";
import * as ui from "@ui";

export const BlockEnvGrid: EnvManagerComponent = (props) => {
  return (
    <div>
      <ui.EnvGrid {...props} />
    </div>
  );
};

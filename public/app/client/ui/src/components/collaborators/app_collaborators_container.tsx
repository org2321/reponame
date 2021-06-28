import React, { useEffect } from "react";
import { OrgComponent } from "@ui_types";
import { AppCollaboratorsTabs } from "./app_collaborators_tabs";

export const AppCollaboratorsContainer: OrgComponent<{ appId: string }> = (
  props
) => {
  const appId = props.routeParams.appId;

  return <AppCollaboratorsTabs {...props} appId={appId} />;
};

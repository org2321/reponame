import React from "react";
import * as g from "@core/lib/graph";
import { Model, Rbac } from "@core/types";
import { Link } from "react-router-dom";
import { getEnvParentPath } from "@ui_lib/paths";
import { OrgComponent } from "@ui_types";

export const BlockUserAccessRow: OrgComponent<
  {},
  {
    connectedApps: Model.App[];
    canReadAllOrgBlocks: boolean;
    orgRole: Rbac.OrgRole;
  }
> = (props) => {
  const { connectedApps, canReadAllOrgBlocks, orgRole } = props;

  let connectedNodes: React.ReactNode;

  const appLinks = connectedApps.map((app) => (
    <Link to={props.orgRoute(getEnvParentPath(app))}>{app.name}</Link>
  ));

  if (canReadAllOrgBlocks) {
    connectedNodes = ["org role: ", <strong>{orgRole.name}</strong>];
  } else if (connectedApps.length > 3) {
    connectedNodes = [
      appLinks[0],
      ", ",
      appLinks[1],
      `, and ${connectedApps.length - 2} more app${
        connectedApps.length == 3 ? "" : "s"
      }`,
    ];
  } else if (connectedApps.length == 3) {
    connectedNodes = [appLinks[0], ", ", appLinks[1], ", and ", appLinks[2]];
  } else if (connectedApps.length == 2) {
    connectedNodes = [appLinks[0], " and ", appLinks[1]];
  } else if (connectedApps.length == 1) {
    connectedNodes = appLinks;
  }

  return (
    <span className="access">
      <span className="connections">Through {connectedNodes}</span>
    </span>
  );
};

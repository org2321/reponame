import React from "react";
import { OrgComponent } from "@ui_types";
import { AppAddOrgUsersTabs } from "./app_add_org_users_tabs";
import { Link } from "react-router-dom";
import * as styles from "@styles";

export const AppAddOrgUsersContainer: OrgComponent<{ appId: string }> = (
  props
) => {
  const appId = props.routeParams.appId;

  return (
    <div>
      <Link
        className={styles.SelectedObjectBackLink}
        to={props.match.url.replace(/\/add$/, "/list")}
      >
        ← Back To Collaborators
      </Link>
      <AppAddOrgUsersTabs {...props} appId={appId} />
    </div>
  );
};

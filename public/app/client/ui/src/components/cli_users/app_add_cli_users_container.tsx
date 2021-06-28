import React from "react";
import { OrgComponent } from "@ui_types";
import { AppAddCliUsersTabs } from "./app_add_cli_users_tabs";
import { Link } from "react-router-dom";
import * as styles from "@styles";

export const AppAddCliUsersContainer: OrgComponent<{ appId: string }> = (
  props
) => {
  const appId = props.routeParams.appId;

  return (
    <div>
      <Link
        className={styles.SelectedObjectBackLink}
        to={props.match.url.replace(/\/add$/, "/list")}
      >
        ← Back To CLI Keys
      </Link>
      <AppAddCliUsersTabs {...props} appId={appId} />
    </div>
  );
};

import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Component } from "@ui_types";
import { Client, Model, Rbac } from "@core/types";
import * as ui from "@ui";
import * as g from "@core/lib/graph";
import * as R from "ramda";
import { getUiTree } from "@ui_lib/ui_tree";
import { getEnvParentPath } from "@ui_lib/paths";
import {
  getPendingUpdateDetails,
  getAllPendingConflicts,
  getNumPendingConflicts,
} from "@core/lib/client";
import { style } from "typestyle";
import * as styles from "@styles";

let initialOrgRoleId: string | undefined;
let initialOrgPermissionsJson: string | undefined;

export const SignedInAccountContainer: Component<{ orgId: string }> = (
  props
) => {
  let auth: Client.ClientUserAuth | undefined;

  const accountsForOrg = Object.values(props.core.orgUserAccounts).filter(
    (account) => account && account.orgId == props.routeParams.orgId
  ) as Client.ClientUserAuth[];

  if (props.ui.accountId) {
    const maybeAuth = props.core.orgUserAccounts[props.ui.accountId];

    if (maybeAuth) {
      auth = maybeAuth;
    }
  }

  if (!auth && accountsForOrg.length == 1) {
    auth = accountsForOrg[0];
  }

  useLayoutEffect(() => {
    if (auth) {
      if (props.ui.accountId !== auth.userId) {
        props.setUiState({
          accountId: auth.userId,
          loadedAccountId: undefined,
        });
      } else if (!auth.token) {
        props.history.replace(`/sign-in/${auth.userId}`);
      }
    } else {
      if (accountsForOrg.length == 0) {
        props.history.replace("/home");
      } else if (accountsForOrg.length > 1) {
        props.history.replace("/select-account");
      }
    }
  }, [auth, props.routeParams.orgId, props.ui.accountId]);

  // handle removed from org, org deleted, or token expired
  useLayoutEffect(() => {
    if (
      props.core.fetchSessionError &&
      typeof props.core.fetchSessionError.error == "object"
    ) {
      switch (props.core.fetchSessionError.error.message) {
        case "device not found":
          alert("This device's access to the organization has been revoked.");
          props.dispatch({
            type: Client.ActionType.FORGET_DEVICE,
            payload: { accountId: props.ui.accountId! },
          });
          props.history.replace("/home");
          break;

        case "user not found":
          alert("You have been removed from this organization.");
          props.dispatch({
            type: Client.ActionType.FORGET_DEVICE,
            payload: { accountId: props.ui.accountId! },
          });
          props.history.replace("/home");
          break;

        case "org not found":
          alert("This organization has been deleted.");
          props.dispatch({
            type: Client.ActionType.FORGET_DEVICE,
            payload: { accountId: props.ui.accountId! },
          });
          props.history.replace("/home");
          break;

        case "token invalid":
        case "token expired":
          props.history.replace(`/sign-in/${props.ui.accountId!}`);
          break;
      }
    }
  }, [props.core.fetchSessionError?.error]);

  const shouldFetchSession = Boolean(
    props.ui.loadedAccountId &&
      auth &&
      auth.token &&
      auth.privkey &&
      !props.core.graphUpdatedAt &&
      !props.core.isFetchingSession
  );

  useEffect(() => {
    if (shouldFetchSession) {
      props.dispatch({ type: Client.ActionType.GET_SESSION });
    }
  }, [props.ui.loadedAccountId, shouldFetchSession]);

  const shouldRequireRecoveryKey = useMemo(() => {
    if (!props.ui.loadedAccountId || !auth || !props.core.graphUpdatedAt) {
      return false;
    }

    const currentUser = props.core.graph[
      props.ui.loadedAccountId
    ] as Model.OrgUser;

    if (
      g.authz.hasOrgPermission(
        props.core.graph,
        currentUser.id,
        "org_generate_recovery_key"
      )
    ) {
      const activeRecoveryKey = g.getActiveRecoveryKeysByUserId(
        props.core.graph
      )[currentUser.id];

      return !activeRecoveryKey;
    }
  }, [
    auth,
    props.core.graphUpdatedAt,
    props.routeParams.orgId,
    props.ui.loadedAccountId,
  ]);

  const [showRequireRecoveryKey, setShowRequireRecoveryKey] = useState(
    shouldRequireRecoveryKey
  );

  useLayoutEffect(() => {
    if (shouldRequireRecoveryKey && !showRequireRecoveryKey) {
      setShowRequireRecoveryKey(true);
    }
  }, [shouldRequireRecoveryKey]);

  const shouldRedirectPath = useMemo(() => {
    if (!props.ui.loadedAccountId) {
      return false;
    }

    if (shouldRequireRecoveryKey || showRequireRecoveryKey) {
      return false;
    }

    if (auth && props.location.pathname.endsWith(props.routeParams.orgId)) {
      const { apps, blocks } = g.graphTypes(props.core.graph);
      const canCreateApp = g.authz.canCreateApp(props.core.graph, auth.userId);

      if (apps.length > 0) {
        return getEnvParentPath(apps[0]);
      } else if (canCreateApp) {
        return "/new-app";
      } else if (blocks.length > 0) {
        return getEnvParentPath(blocks[0]);
      } else {
        return "/no-apps-or-blocks";
      }
    }
  }, [
    auth,
    props.core.graphUpdatedAt,
    props.location.pathname.endsWith(props.routeParams.orgId),
    shouldRequireRecoveryKey || showRequireRecoveryKey,
    props.routeParams.orgId,
    props.ui.loadedAccountId,
  ]);

  const orgRoute = (path: string) => {
    if (props.ui.loadedAccountId) {
      const account = props.core.orgUserAccounts[props.ui.loadedAccountId];
      if (account) {
        return `/org/${account.orgId}${path}`;
      }
    }
    return "";
  };

  // default path
  useLayoutEffect(() => {
    if (shouldRedirectPath) {
      props.history.replace(orgRoute(shouldRedirectPath));
    }
  }, [shouldRedirectPath]);

  const uiTree = useMemo(
    () =>
      auth && !shouldRedirectPath && props.ui.loadedAccountId
        ? getUiTree(props.core, auth!.userId, props.ui.now)
        : null,
    [
      props.ui.loadedAccountId,
      props.core.graphUpdatedAt,
      auth,
      shouldRedirectPath,
      props.ui.now,
    ]
  );

  const { pendingUpdateDetails, pendingConflicts, numPendingConflicts } =
    useMemo(() => {
      let params: Parameters<typeof getPendingUpdateDetails>[1];
      if (props.ui.importingNewEnvParentId) {
        const { apps, blocks } = g.graphTypes(props.core.graph);
        const envParentIds = new Set([...apps, ...blocks].map(R.prop("id")));
        envParentIds.delete(props.ui.importingNewEnvParentId);
        params = { envParentIds };
      }

      const pendingUpdateDetails = getPendingUpdateDetails(props.core, params);
      const pendingConflicts = getAllPendingConflicts(props.core);
      const numPendingConflicts = getNumPendingConflicts(props.core);

      return {
        pendingUpdateDetails,
        pendingConflicts,
        numPendingConflicts,
      };
    }, [props.core]);

  useEffect(() => {
    if (
      props.core.pendingEnvUpdates.length > 0 &&
      props.ui.pendingFooterHeight == 0
    ) {
      props.setUiState({
        pendingFooterHeight: styles.layout.DEFAULT_PENDING_FOOTER_HEIGHT,
      });
    } else if (
      props.core.pendingEnvUpdates.length == 0 &&
      props.ui.pendingFooterHeight != 0
    ) {
      props.setUiState({
        pendingFooterHeight: 0,
      });
    }
  }, [props.core]);

  const currentUser = auth
    ? (props.core.graph[auth.userId] as Model.OrgUser)
    : undefined;
  const orgRole = currentUser
    ? (props.core.graph[currentUser.orgRoleId] as Rbac.OrgRole)
    : undefined;
  const orgPermissionsJson = JSON.stringify(
    orgRole
      ? Array.from(g.getOrgPermissions(props.core.graph, orgRole.id)).sort()
      : []
  );

  useEffect(() => {
    if (orgRole) {
      initialOrgRoleId = orgRole?.id;
      initialOrgPermissionsJson = orgPermissionsJson;
    }
  }, [auth?.userId, Boolean(orgRole)]);

  useEffect(() => {
    if (orgRole && initialOrgRoleId != orgRole.id) {
      alert(
        "Your role in the organization has been changed. Your role is now: " +
          orgRole.name
      );
    } else if (orgRole && orgPermissionsJson != initialOrgPermissionsJson) {
      alert("Your permissions for this organization have been updated.");
    }

    initialOrgRoleId = orgRole?.id;
    initialOrgPermissionsJson = orgPermissionsJson;
  }, [auth?.userId, orgRole?.id, orgPermissionsJson]);

  if (
    !props.ui.loadedAccountId ||
    !currentUser ||
    !auth ||
    shouldRedirectPath ||
    !uiTree
  ) {
    return <div></div>;
  }

  const hasPendingEnvUpdates = pendingUpdateDetails.filteredUpdates.length > 0;

  const orgProps = {
    ...props,
    uiTree,
    orgRoute,
    hasPendingEnvUpdates,
  };

  if (showRequireRecoveryKey) {
    return (
      <ui.RequireRecoveryKey
        {...orgProps}
        onClear={() => setShowRequireRecoveryKey(false)}
      />
    );
  }

  return (
    <div>
      <section
        className={style({
          position: "fixed",
          top: 0,
          left: 0,
          width: styles.layout.SIDEBAR_WIDTH,
          height: `calc(100% - ${props.ui.pendingFooterHeight}px)`,
        })}
      >
        <ui.Sidebar {...orgProps} />
      </section>

      <section
        className={style({
          position: "absolute",
          top: 0,
          left: styles.layout.SIDEBAR_WIDTH,
          width: `calc(100% - ${styles.layout.SIDEBAR_WIDTH}px)`,
          background: "#fff",
          paddingBottom: hasPendingEnvUpdates
            ? props.ui.pendingFooterHeight
            : 0,
        })}
      >
        <ui.OrgRoutes {...orgProps} />
      </section>

      {hasPendingEnvUpdates ? (
        <ui.PendingFooter
          {...orgProps}
          pendingUpdateDetails={pendingUpdateDetails}
          pendingConflicts={pendingConflicts}
          numPendingConflicts={numPendingConflicts}
        />
      ) : (
        ""
      )}
    </div>
  );
};

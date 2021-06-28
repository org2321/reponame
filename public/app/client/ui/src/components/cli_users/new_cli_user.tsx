import React, { useState, useMemo, useLayoutEffect } from "react";
import { Link } from "react-router-dom";
import { OrgComponent } from "@ui_types";
import { Rbac, Model, Client } from "@core/types";
import * as g from "@core/lib/graph";
import * as R from "ramda";
import { cliUserRoute } from "./helpers";
import * as styles from "@styles";
import { SvgImage } from "@images";
import { MIN_ACTION_DELAY_MS } from "@constants";
import { wait } from "@core/lib/utils/wait";

export const NewCliUser: OrgComponent<{
  appId?: string;
}> = (props) => {
  const { graph, graphUpdatedAt } = props.core;
  const currentUserId = props.ui.loadedAccountId!;
  const appId = props.routeParams.appId;

  const [name, setName] = useState("");

  const [generating, setGenerating] = useState(false);
  const [awaitingMinDelay, setAwaitingMinDelay] = useState(false);

  useLayoutEffect(() => {
    if (props.core.generatedCliUsers.length > 0 && !awaitingMinDelay) {
      props.history.push(cliUserRoute(props, "/generated-cli-key"));
    }
  }, [props.core.generatedCliUsers.length > 0, awaitingMinDelay]);

  const [
    validOrgRoleIds,
    grantableAppIds,
    license,
    numActiveCliUsers,
  ] = useMemo(() => {
    let grantableAppIds = g.authz
      .getAccessGrantableApps(graph, currentUserId)
      .map(R.prop("id"));
    if (appId) {
      grantableAppIds = [appId, ...R.without([appId], grantableAppIds)];
    }

    return [
      g.authz
        .getCliUserCreatableOrgRoles(graph, currentUserId)
        .map(R.prop("id")),
      grantableAppIds,
      g.graphTypes(graph).license,
      g.getActiveCliUsers(graph).length,
    ];
  }, [graphUpdatedAt, currentUserId]);

  const [orgRoleId, setOrgRoleId] = useState(
    validOrgRoleIds[validOrgRoleIds.length - 1]
  );

  const grantableAppRoleIdsByAppId = useMemo(
    () =>
      R.mergeAll(
        grantableAppIds.map((id) => ({
          [id]: g.authz
            .getAccessGrantableAppRolesForOrgRole(
              graph,
              currentUserId,
              id,
              orgRoleId
            )
            .map(R.prop("id")),
        }))
      ),
    [graphUpdatedAt, currentUserId, grantableAppIds, orgRoleId]
  );

  const defaultAppUserGrants: Required<
    Client.PendingInvite["appUserGrants"]
  > = appId
    ? [
        {
          appId,
          appRoleId: R.last(grantableAppRoleIdsByAppId[appId])!,
        },
      ]
    : [];

  const [appUserGrantsByAppId, setAppUserGrantsByAppId] = useState<
    Record<string, Required<Client.PendingInvite>["appUserGrants"][0]>
  >(R.indexBy(R.prop("appId"), defaultAppUserGrants));

  const canSubmit = !generating && name && orgRoleId;

  const onSubmit = () => {
    if (!canSubmit) {
      return;
    }

    setGenerating(true);
    setAwaitingMinDelay(true);

    wait(MIN_ACTION_DELAY_MS).then(() => setAwaitingMinDelay(false));

    const appUserGrants = Object.values(appUserGrantsByAppId);

    props.dispatch({
      type: Client.ActionType.CREATE_CLI_USER,
      payload: {
        name,
        orgRoleId,
        appUserGrants,
      },
    });
  };

  const selectedOrgRole = orgRoleId
    ? (graph[orgRoleId] as Rbac.OrgRole)
    : undefined;

  const licenseExpired =
    license.expiresAt != -1 && props.ui.now > license.expiresAt;
  if (numActiveCliUsers >= license.maxCliUsers || licenseExpired) {
    const blockStatement = licenseExpired
      ? `Your organization's ${
          license.provisional ? "provisional " : ""
        }license has expired.`
      : `Your organization has reached its limit of ${license.maxCliUsers} CLI keys.`;

    return (
      <div>
        <p>{blockStatement}</p>
        {g.authz.hasOrgPermission(
          graph,
          currentUserId,
          "org_manage_billing"
        ) ? (
          <p>
            To generate more CLI keys,{" "}
            <Link to={props.orgRoute("/my-org/billing")}>
              {licenseExpired ? "renew" : "upgrade"} your org's license.
            </Link>
          </p>
        ) : (
          <p>
            To generate more CLI keys, ask an admin to{" "}
            {licenseExpired ? "renew" : "upgrade"} your org's license.
          </p>
        )}
      </div>
    );
  }

  const orgRoleOptions = validOrgRoleIds.map((id) => (
    <option value={id} label={(graph[id] as Rbac.OrgRole).name} />
  ));

  const form = (
    <form>
      <div className="field">
        <label>CLI Key Name</label>
        <input
          type="text"
          disabled={generating}
          placeholder="Enter a name..."
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label>Org Role</label>
        <div className={"select" + (generating ? " disabled" : "")}>
          <select
            disabled={generating}
            value={orgRoleId}
            onChange={(e) => setOrgRoleId(e.target.value)}
          >
            {orgRoleOptions}
          </select>
          <SvgImage type="down-caret" />
        </div>
      </div>
    </form>
  );

  let appRoles: React.ReactNode;
  if (
    selectedOrgRole &&
    !selectedOrgRole.autoAppRoleId &&
    grantableAppIds.length > 0
  ) {
    const apps = grantableAppIds.map((grantableAppId) => {
      const app = graph[grantableAppId] as Model.App;

      return (
        <div className="field">
          <label>
            {grantableAppId == appId ? <strong>{app.name}</strong> : app.name}
          </label>
          <div className={"select" + (generating ? " disabled" : "")}>
            <select
              disabled={generating}
              value={appUserGrantsByAppId[grantableAppId]?.appRoleId ?? ""}
              onChange={(e) => {
                const appRoleId = e.target.value;
                setAppUserGrantsByAppId(
                  appRoleId
                    ? {
                        ...appUserGrantsByAppId,
                        [grantableAppId]: { appId: grantableAppId, appRoleId },
                      }
                    : R.omit([grantableAppId], appUserGrantsByAppId)
                );
              }}
            >
              {[
                <option value="">No Access</option>,
                ...grantableAppRoleIdsByAppId[
                  grantableAppId
                ].map((appRoleId) => (
                  <option value={appRoleId}>
                    {(graph[appRoleId] as Rbac.AppRole).name}
                  </option>
                )),
              ]}
            </select>
            <SvgImage type="down-caret" />
          </div>
        </div>
      );
    });

    appRoles = [<h4>App Access</h4>, apps];
  }

  return (
    <div className={styles.OrgContainer}>
      <h3>
        Generate <strong>CLI Key</strong>
      </h3>
      <p>
        CLI Keys let you interface <em>programatically</em> with EnvKey's CLI in{" "}
        <strong>Auto Mode</strong>. You can assign them an Org Role and access
        to apps just like a human user, and they can do just about anything a
        human can do. They're useful for CI/CD and automation tasks.
      </p>

      <p>
        If you just want to load config, locally or on a server, you're better
        off with a <strong>Server or Local Development ENVKEY</strong>.
      </p>

      <p>
        If you want to use the EnvKey CLI instead of the UI, you don't need a
        CLI Key for that either. You can use the CLI in{" "}
        <strong>Interactive Mode</strong>. Type <code>envkey</code> into a shell
        to see the available commands.
      </p>

      {form}
      {appRoles}
      <div className="buttons">
        <button
          className="primary"
          onClick={onSubmit}
          disabled={!canSubmit || generating}
        >
          {generating ? "Generating..." : "Generate CLI Key"}
        </button>
      </div>
    </div>
  );
};

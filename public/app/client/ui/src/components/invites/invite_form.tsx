import React, { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { OrgComponent } from "@ui_types";
import { Rbac, Model, Client, Auth, Api } from "@core/types";
import * as g from "@core/lib/graph";
import * as R from "ramda";
import { inviteRoute } from "./helpers";
import * as styles from "@styles";
import * as z from "zod";
import { SvgImage } from "@images";
import { graphTypes } from "@core/lib/graph";

const emailValidator = z.string().email();

export const InviteForm: OrgComponent<{
  editIndex?: string;
  appId?: string;
}> = (props) => {
  const { graph, graphUpdatedAt, pendingInvites } = props.core;
  const currentUserId = props.ui.loadedAccountId!;
  const appId = props.routeParams.appId;
  const samlProviders = graphTypes(graph).externalAuthProviders.filter(
    (p) => p.provider === "saml"
  );
  const scimProviders = graphTypes(graph).scimProvisioningProviders;

  const editIndex = props.routeParams.editIndex
    ? parseInt(props.routeParams.editIndex)
    : undefined;

  const editingPendingInvite =
    typeof editIndex == "number" ? pendingInvites[editIndex] : undefined;

  // Default to SAML
  const [provider, setProvider] = useState<"saml" | "email">(
    samlProviders.length > 0 ? "saml" : "email"
  );
  const [externalAuthProviderId, setExternalAuthProviderId] = useState<
    string | undefined
  >(samlProviders.length > 0 ? samlProviders[0].id : undefined);
  const [scimProvider, setScimProvider] = useState<
    Model.ScimProvisioningProvider | undefined
  >(scimProviders?.length > 0 ? scimProviders[0] : undefined);
  const [candidates, setCandidates] = useState<Model.ScimUserCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<
    Model.ScimUserCandidate | undefined
  >();

  const [firstName, setFirstName] = useState(
    editingPendingInvite?.user.firstName ?? ""
  );
  const [lastName, setLastName] = useState(
    editingPendingInvite?.user.lastName ?? ""
  );
  const [email, setEmail] = useState(editingPendingInvite?.user.email ?? "");

  const [submittedEmail, setSubmittedEmail] = useState("");

  const [invitableOrgRoleIds, grantableAppIds] = useMemo(() => {
    let grantableAppIds = g.authz
      .getAccessGrantableApps(graph, currentUserId)
      .map(R.prop("id"));
    if (appId) {
      grantableAppIds = [appId, ...R.without([appId], grantableAppIds)];
    }

    return [
      g.authz.getInvitableOrgRoles(graph, currentUserId).map(R.prop("id")),
      grantableAppIds,
      g.graphTypes(graph).license,
    ];
  }, [graphUpdatedAt, currentUserId]);

  const [license, numActiveOrPending] = useMemo(() => {
    const numActiveDevices = Object.values(
      g.getActiveOrgUserDevicesByUserId(graph)
    ).flat().length;
    const numActiveInvites = g.getActiveInvites(graph, props.ui.now).length;
    const numActiveGrants = g.getActiveDeviceGrants(graph, props.ui.now).length;
    const numPending = props.core.pendingInvites.length;
    const numActiveOrPending =
      numActiveDevices + numActiveInvites + numActiveGrants + numPending;

    return [g.graphTypes(graph).license, numActiveOrPending];
  }, [
    graphUpdatedAt,
    props.core.pendingInvites.length,
    currentUserId,
    props.ui.now,
  ]);

  const [orgRoleId, setOrgRoleId] = useState(
    editingPendingInvite?.user.orgRoleId ??
      invitableOrgRoleIds[invitableOrgRoleIds.length - 1]
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

  const pendingEmails = useMemo(
    () =>
      new Set(
        R.without([editingPendingInvite], props.core.pendingInvites).map(
          (pending) => pending!.user.email
        )
      ),
    [props.core.pendingInvites.length]
  );

  const initialPendingEmails = useMemo(() => pendingEmails, []);

  const activeEmails = useMemo(
    () => new Set(g.getActiveOrgUsers(graph).map(R.prop("email"))),
    [graphUpdatedAt]
  );

  const emailValid = useMemo(
    () => !email || emailValidator.safeParse(email).success,
    [email]
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
  >(
    R.indexBy(
      R.prop("appId"),
      editingPendingInvite?.appUserGrants ?? defaultAppUserGrants
    )
  );

  useEffect(() => {
    if (selectedCandidate) {
      setEmail(selectedCandidate.email);
      setFirstName(selectedCandidate.firstName);
      setLastName(selectedCandidate.lastName);
    } else {
      setEmail("");
      setFirstName("");
      setLastName("");
    }
  }, [selectedCandidate?.id]);
  useEffect(() => {
    setEmail("");
    setFirstName("");
    setLastName("");
    setSelectedCandidate(undefined);
    setCandidates([]);

    if (!scimProvider) {
      return;
    }

    props
      .dispatch({
        type: Api.ActionType.LIST_INVITABLE_SCIM_USERS,
        // TODO: search better without `all`
        payload: { id: scimProvider.id, all: true },
      })
      .then((res) => {
        console.log("LIST_INVITABLE_SCIM_USERS", res.resultAction);
        if (res.success) {
          const fetchedCandidates = (res as any).resultAction?.payload
            ?.scimUserCandidates;
          if (fetchedCandidates?.length) {
            setCandidates(fetchedCandidates as Model.ScimUserCandidate[]);
          }
        }
      })
      .catch((err) => {
        console.error("Failed LIST_INVITABLE_SCIM_USERS", err);
      });
  }, [scimProvider?.id]);

  useEffect(() => {
    if (submittedEmail && pendingEmails.has(email)) {
      props.history.push(inviteRoute(props, "/invite-users"));
    }
  }, [pendingEmails]);

  useEffect(() => {
    if (provider === "email") {
      setExternalAuthProviderId(undefined);
    } else if (!externalAuthProviderId) {
      setExternalAuthProviderId(samlProviders[0]?.id);
    }
  }, [provider]);

  const canSubmit =
    email &&
    firstName &&
    lastName &&
    orgRoleId &&
    emailValid &&
    !initialPendingEmails.has(email) &&
    !activeEmails.has(email);

  const onSubmit = () => {
    if (!canSubmit) {
      return;
    }
    const appUserGrants = Object.values(appUserGrantsByAppId);

    const pending: Client.PendingInvite = {
      user: {
        provider: provider as "saml" | "email",
        externalAuthProviderId:
          provider === "saml" ? externalAuthProviderId : undefined,
        uid: email,
        email,
        firstName,
        lastName,
        orgRoleId,
      },
      appUserGrants: appUserGrants.length > 0 ? appUserGrants : undefined,
    };
    if (scimProvider?.id && selectedCandidate?.email === email) {
      pending.scim = {
        candidateId: selectedCandidate.id,
        providerId: scimProvider.id,
      };
    }

    if (typeof editIndex == "number") {
      props.dispatch({
        type: Client.ActionType.UPDATE_PENDING_INVITE,
        payload: { index: editIndex, pending },
      });

      props.history.push(inviteRoute(props, "/invite-users"));
    } else {
      setSubmittedEmail(email);

      props.dispatch({
        type: Client.ActionType.ADD_PENDING_INVITE,
        payload: pending,
      });
    }
  };

  let cancelBtn: React.ReactNode;
  if (pendingInvites.length > 0) {
    cancelBtn = (
      <button
        className="secondary"
        onClick={() => {
          props.history.push(inviteRoute(props, "/invite-users"));
        }}
      >
        ← Back
      </button>
    );
  }

  const licenseExpired =
    license.expiresAt != -1 && props.ui.now > license.expiresAt;
  if (numActiveOrPending >= license.maxDevices || licenseExpired) {
    const blockStatement = licenseExpired
      ? [
          `Your organization's ${
            license.provisional ? "provisional " : ""
          }license has `,
          <strong>expired.</strong>,
        ]
      : [
          "Your organization has reached its limit of ",
          <strong>{license.maxDevices} active or pending devices.</strong>,
        ];

    const canManageBilling = g.authz.hasOrgPermission(
      graph,
      currentUserId,
      "org_manage_billing"
    );

    return (
      <div className={styles.OrgContainer}>
        <h3>
          {licenseExpired ? "Renew" : "Upgrade"} <strong>License</strong>
        </h3>
        <p>{blockStatement}</p>
        {g.authz.hasOrgPermission(
          graph,
          currentUserId,
          "org_manage_billing"
        ) ? (
          <p>
            To invite someone else, {licenseExpired ? "renew" : "upgrade"} your
            org's license.
          </p>
        ) : (
          <p>
            To invite someone else, ask an admin to{" "}
            {licenseExpired ? "renew" : "upgrade"} your org's license.
          </p>
        )}
        {cancelBtn || canManageBilling ? (
          <div className="buttons">
            {cancelBtn}
            {canManageBilling ? (
              <Link className="primary" to={props.orgRoute("/my-org/billing")}>
                Go To Billing →
              </Link>
            ) : (
              ""
            )}
          </div>
        ) : (
          ""
        )}
      </div>
    );
  }

  const selectedOrgRole = orgRoleId
    ? (graph[orgRoleId] as Rbac.OrgRole)
    : undefined;

  const orgRoleOptions = invitableOrgRoleIds.map((id) => (
    <option value={id} label={(graph[id] as Rbac.OrgRole).name} />
  ));
  const inviteAuthMethodComponent =
    samlProviders.length > 0 ? (
      <div className="field">
        <label>Auth Method</label>
        <div className="select">
          <select
            value={externalAuthProviderId || email}
            onChange={(e) => {
              if (e.target.value === "email") {
                setProvider("email");
              } else {
                setExternalAuthProviderId(e.target.value);
                setProvider("saml");
              }
            }}
          >
            <option value="email">Email</option>
            <optgroup label={Auth.AUTH_PROVIDERS["saml"]}>
              {samlProviders.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.nickname}
                </option>
              ))}
            </optgroup>
          </select>

          <SvgImage type="down-caret" />
        </div>
      </div>
    ) : null;
  const inviteFromMethodComponent =
    scimProviders.length > 0 ? (
      <div className="field">
        <label>User Source</label>
        <div className="select">
          <select
            value={scimProvider?.id || ""}
            onChange={(e) => {
              if (!e.target.value) {
                setScimProvider(undefined);
              } else {
                setScimProvider(
                  scimProviders.find((s) => s.id === e.target.value)
                );
              }
            }}
          >
            <option value="">Email</option>
            <optgroup label="SCIM User Provisioning">
              {scimProviders.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.nickname}
                </option>
              ))}
            </optgroup>
          </select>

          <SvgImage type="down-caret" />
        </div>
      </div>
    ) : null;

  const form = (
    <form>
      {inviteAuthMethodComponent}
      {inviteFromMethodComponent}
      {scimProvider ? (
        <div>
          <div className="field">
            <label htmlFor="scimUserSearch">
              Find a user from {scimProvider.nickname}
            </label>
            <input
              list="scimUsers"
              id="scimUserSearch"
              name="scimUserSearch"
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedCandidate(
                    candidates.find((c) => c.id === e.target.value)
                  );
                } else {
                  setSelectedCandidate(undefined);
                }
              }}
            />
            <datalist id="scimUsers">
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.scimDisplayName || [c.firstName, c.lastName].join(" ")} &lt;{c.email}&gt; ({c.scimUserName}, {c.scimExternalId})
                </option>
              ))}
            </datalist>
          </div>
          <div className="field">
            <label>Name</label>
            <input type="text" disabled={true} value={firstName} />
            <input type="text" disabled={true} value={lastName} />
          </div>
          <div className="field">
            <label>Email</label>
            <input disabled={true} type="email" value={email} />
          </div>
        </div>
      ) : (
        <div>
          <div className="field">
            <label>Name</label>
            <input
              type="text"
              placeholder="Enter the person's first name..."
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <input
              type="text"
              placeholder="Enter the person's last name..."
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              placeholder="Enter a valid email address..."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
      )}

      {emailValid || email.length < 5 ? (
        ""
      ) : (
        <p className="error">Not a valid email.</p>
      )}
      {initialPendingEmails.has(email) ? (
        <p className="error">
          An invitation for someone with this email is already pending.
        </p>
      ) : (
        ""
      )}
      {activeEmails.has(email) ? (
        <p className="error">
          Someone with this email is already an active member of the
          organization.
        </p>
      ) : (
        ""
      )}

      <div className="field">
        <label>Org Role</label>
        <div className="select">
          <select
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
          <div className="select">
            <select
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

    appRoles = [<h4>App Access</h4>, <div>{apps}</div>];
  }

  return (
    <div className={styles.OrgContainer}>
      <h3>
        Send An <strong>Invitation</strong>
      </h3>
      {form}
      {appRoles}
      <div className="buttons">
        {cancelBtn}
        <button className="primary" onClick={onSubmit} disabled={!canSubmit}>
          {typeof editIndex == "number" ? "Update" : "Next"}
        </button>
      </div>
    </div>
  );
};

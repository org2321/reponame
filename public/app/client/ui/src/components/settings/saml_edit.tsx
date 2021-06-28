import React, { useEffect, useState } from "react";
import { OrgComponent } from "@ui_types";
import { Api, Auth, Model } from "@core/types";

export const SamlEdit: OrgComponent<
  {},
  {
    provider: Model.ExternalAuthProvider;
    samlSettings: Partial<Model.SamlProviderSettings>;
    cancelEdit: () => void;
  }
> = (props) => {
  const { dispatch, provider, samlSettings, cancelEdit } = props;

  useEffect(() => {
    // scroll to top on mount
    window.scrollTo(0, 0);
  }, []);

  const [nickname, setNickname] = useState<string>(provider.nickname || "");
  const [
    identityProviderKnownService,
    setIdentityProviderKnownService,
  ] = useState<Auth.SamlKnownIdP | undefined>(
    samlSettings.identityProviderKnownService
  );
  const [identityProviderEntityId, setIdentityProviderEntityId] = useState<
    string
  >(samlSettings.identityProviderEntityId || "");
  const [identityProviderLoginUrl, setIdentityProviderLoginUrl] = useState<
    string
  >(samlSettings.identityProviderLoginUrl || "");
  const [identityProviderX509Certs, setIdentityProviderX509Certs] = useState<
    string[]
  >(samlSettings.identityProviderX509Certs || []);
  const [
    serviceProviderAttributeMappings,
    setServiceProviderAttributeMappings,
  ] = useState<Record<Auth.SamlMappable, string>>(
    samlSettings.serviceProviderAttributeMappings || {
      emailAddress: "",
      firstName: "",
      lastName: "",
    }
  );
  // pass cert=undefined to remove it
  const setIdentityProviderX509CertAtIndex = (
    ix: number,
    cert: string | undefined
  ) => {
    let newCerts = [...identityProviderX509Certs];
    if (typeof cert === "undefined") {
      newCerts.splice(ix, 1);
    } else {
      newCerts[ix] = cert;
    }
    setIdentityProviderX509Certs(newCerts);
  };

  const save = (
    nickname: string,
    samlSettings: Partial<Model.SamlProviderSettings>
  ) => {
    props
      .dispatch({
        type: Api.ActionType.UPDATE_ORG_SAML_SETTINGS,
        payload: {
          id: provider.id,
          nickname,
          samlSettings: {
            identityProviderKnownService: identityProviderKnownService as Auth.SamlKnownIdP,
            identityProviderEntityId,
            identityProviderLoginUrl,
            identityProviderX509Certs: identityProviderX509Certs
              .map((c) => c.trim())
              .filter(Boolean),
          },
        },
      })
      .then(() =>
        props.dispatch({
          type: Api.ActionType.GET_EXTERNAL_AUTH_PROVIDERS,
          payload: {
            provider: "saml",
          },
        })
      )
      .then(() => cancelEdit());
  };

  return (
    <div>
      <div className="field">
        <label>
          {Auth.AUTH_PROVIDERS[provider.provider]}
          <a
            className="secondary"
            style={{ float: "right" }}
            onClick={(e) => {
              e.preventDefault();
              cancelEdit();
            }}
          >
            Cancel Edit
          </a>
        </label>
      </div>

      <div className="field">
        <label>Name</label>
        <input
          type="text"
          placeholder="Enter a name..."
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </div>

      <div className="field">
        <label>(IdP) Identity Provider Known Service</label>
        <div className="select">
          <select
            value={identityProviderKnownService}
            onChange={(e) =>
              setIdentityProviderKnownService(
                e.target.value as Auth.SamlKnownIdP
              )
            }
          >
            {Object.keys(Auth.SAML_KNOWN_IDENTITY_PROVIDERS).map((known) => (
              <option key={known} value={known}>
                {known}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>(IdP) Identity Provider Entity ID</label>
        <input
          type="text"
          placeholder="Entity ID..."
          value={identityProviderEntityId}
          onChange={(e) => setIdentityProviderEntityId(e.target.value)}
        />
      </div>

      <div className="field">
        <label>(IdP) Identity Provider Login URL</label>
        <input
          type="text"
          placeholder="URL..."
          value={identityProviderLoginUrl}
          onChange={(e) => setIdentityProviderLoginUrl(e.target.value)}
        />
      </div>

      <div className="field">
        <label>(IdP) Identity Provider Certificates</label>

        {/* Each idp cert */}

        {!identityProviderX509Certs?.length ? (
          <div className="active">
            <button
              style={{ float: "right" }}
              className="primary"
              onClick={(e) => {
                e.preventDefault();
                setIdentityProviderX509Certs([
                  ...identityProviderX509Certs,
                  "",
                ]);
              }}
            >
              Add
            </button>
            There are no identity provider certificates yet.
          </div>
        ) : (
          <div>
            <div className="active">
              <button
                style={{ float: "right" }}
                className="primary"
                onClick={(e) => {
                  e.preventDefault();
                  setIdentityProviderX509Certs([
                    ...identityProviderX509Certs,
                    "",
                  ]);
                }}
              >
                Add
              </button>
              {identityProviderX509Certs.length === 1
                ? "There is 1 identity provider certificate."
                : `There are ${identityProviderX509Certs.length} identity provider certificates`}
            </div>
            {identityProviderX509Certs.map((c, ix) => (
              <div className="active field" key={`idp-cert-${ix}`}>
                <span>
                  <strong>#{ix + 1}</strong>
                  <button
                    className="secondary"
                    style={{ margin: "5px 0" }}
                    onClick={(e) => {
                      e.preventDefault();
                      if (c) {
                        const conf = window.confirm("Remove this certificate?");
                        if (!conf) {
                          return;
                        }
                      }

                      setIdentityProviderX509CertAtIndex(ix, undefined);
                    }}
                  >
                    Remove
                  </button>
                </span>
                <textarea
                  value={c}
                  placeholder="-----BEGIN CERTIFICATE----- MIIDIzCCAgugAwIBAgIBADANBgkqhkiG9w0BAQUFADAAMB4XDTIxMDMyMzIxMzkw..."
                  onChange={(e) =>
                    setIdentityProviderX509CertAtIndex(ix, e.target.value)
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <label>User Attribute Mappings</label>

        <div className="active">
          <div className="title">
            Email address expected SAML attribute name from IdP (required)
          </div>
          <input
            type="text"
            value={serviceProviderAttributeMappings.emailAddress}
            onChange={(e) => {
              setServiceProviderAttributeMappings({
                ...serviceProviderAttributeMappings,
                emailAddress: e.target.value,
              });
            }}
          />
        </div>

        <div className="active">
          <div className="title">First name attribute from IdP (optional)</div>
          <input
            type="text"
            value={serviceProviderAttributeMappings.firstName}
            onChange={(e) => {
              setServiceProviderAttributeMappings({
                ...serviceProviderAttributeMappings,
                firstName: e.target.value,
              });
            }}
          />
        </div>

        <div className="active">
          <div className="title">Last name attribute from IdP (optional)</div>
          <input
            type="text"
            value={serviceProviderAttributeMappings.lastName}
            onChange={(e) => {
              setServiceProviderAttributeMappings({
                ...serviceProviderAttributeMappings,
                lastName: e.target.value,
              });
            }}
          />
        </div>
      </div>

      <div className="buttons">
        <button
          className="primary"
          disabled={Boolean(props.core.isUpdatingSamlSettings)}
          onClick={(e) => {
            e.preventDefault();
            save(nickname, {
              identityProviderKnownService,
              identityProviderEntityId,
              identityProviderLoginUrl,
              identityProviderX509Certs,
              serviceProviderAttributeMappings,
            });
          }}
        >
          {props.core.isUpdatingSamlSettings
            ? "Saving..."
            : "Save Auth Provider"}
        </button>
      </div>

      <div className="danger-zone">
        <h3>Danger Zone</h3>
        <div className="buttons">
          <button
            className="primary"
            disabled={Boolean(props.core.isDeletingAuthProvider)}
            onClick={(e) => {
              e.preventDefault();
              const conf = window.confirm(
                "This will completely delete the auth provider. Continue?"
              );
              if (!conf) {
                return;
              }
              dispatch({
                type: Api.ActionType.DELETE_EXTERNAL_AUTH_PROVIDER,
                payload: {
                  id: provider.id,
                },
              });
            }}
          >
            {props.core.isDeletingAuthProvider ? "Deleting..." : "Delete Now"}
          </button>
        </div>
        <div className="active">
          <span className="subtitle">
            Deleting the auth provider <strong>{nickname}</strong> will result
            in all its users being converted to email auth.
          </span>
        </div>
      </div>
    </div>
  );
};

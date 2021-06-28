import React, { useState, useEffect } from "react";
import { OrgComponent } from "@ui_types";
import { Api, Auth, Client } from "@core/types";
import * as g from "@core/lib/graph";
import * as styles from "@styles";
import { ExternalLink } from "../shared";
import { SmallLoader } from "@images";
import { SamlEdit } from "./saml_edit";
import { SamlDisplay } from "./saml_display";
import { ScimDisplay, ScimEdit } from "./scim";

export const SingleSignOnSettings: OrgComponent = (props) => {
  const { graph } = props.core;
  const org = g.getOrg(graph);
  const samlProviders = g
    .graphTypes(graph)
    .externalAuthProviders.filter((p) => p.provider === "saml");
  const scimProviders = g.graphTypes(graph).scimProvisioningProviders;
  const defaultNewSamlProviderName =
    "New SAML Provider" +
    (samlProviders?.length ? " " + samlProviders?.length + 1 : "");
  const defaultNewScimProviderName =
    "New SCIM Provisioner " +
    (scimProviders?.length ? " " + scimProviders.length + 1 : "");

  const [editingSamlProviderById, setEditingSamlProviderById] = useState<
    Record<string, boolean>
  >({});

  const [editingScimProviderById, setEditingScimProviderById] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (!samlProviders.length) {
      return;
    }
    if (props.core.isFetchingAuthProviders) {
      return;
    }

    props.dispatch({
      type: Api.ActionType.GET_EXTERNAL_AUTH_PROVIDERS,
      payload: {
        provider: "saml",
      },
    });
  }, [
    samlProviders
      .map((s) => [s.id, s.updatedAt].join(","))
      .sort()
      .join("|"),
  ]);

  const samlError: any =
    props.core.fetchAuthProvidersError?.error ??
    props.core.createSamlError?.error ??
    props.core.deleteAuthProviderError?.error ??
    props.core.updatingSamlSettingsError?.error;
  const scimError: any =
    props.core.createProvisioningProviderError?.error ??
    props.core.deleteProvisioningProviderError?.error ??
    props.core.updatingProvisioningProviderError?.error;

  return (
    <div className={styles.OrgContainer}>
      <div>
        <h3>
          Single <strong>Sign-On</strong> Provider
          {props.core.isFetchingAuthProviders ? (
            <span style={{ float: "right" }}>
              <SmallLoader />
            </span>
          ) : null}
        </h3>
        <p>
          EnvKey supports third party auth. Setup a provider here{" "}
          <strong>before</strong> inviting the users.
        </p>
        <p>
          <strong>Note:</strong> SAML 2.0 is the only supported SSO method.
          Request new auth providers at{" "}
          <a href="mailto:support@envkey.com">
            <strong>support@envkey.com</strong>
          </a>
        </p>

        {samlError ? (
          <p className="error">
            {"message" in samlError
              ? samlError?.message
              : "SAML error " + samlError}
          </p>
        ) : null}

        {!samlProviders.length ? (
          <div className="field">
            <label>
              {Auth.AUTH_PROVIDERS["saml"]}
              <button
                className="primary"
                style={{ float: "right" }}
                disabled={Boolean(props.core.isCreatingSamlProvider)}
                onClick={(e) => {
                  e.preventDefault();
                  // TODO: add help for saml generation
                  window.alert(
                    "SAML settings will be generated. After adding them to your identity provider, come back here and edit the IdP settings."
                  );
                  props.dispatch({
                    type: Api.ActionType.CREATE_ORG_SAML_PROVIDER,
                    payload: {
                      nickname: defaultNewSamlProviderName,
                    },
                  });
                }}
              >
                {props.core.isCreatingSamlProvider ? "Creating..." : "Setup"}
              </button>
            </label>
          </div>
        ) : null}

        {samlProviders.map((p) => {
          const editFunc = () =>
            setEditingSamlProviderById({
              ...editingSamlProviderById,
              [p.id]: true,
            });

          return !editingSamlProviderById[p.id] ? (
            <SamlDisplay
              key={p.id}
              provider={p}
              samlSettings={props.core.samlSettingsByProviderId?.[p.id] || {}}
              copy={(value: string) =>
                props.dispatch({
                  type: Client.ActionType.WRITE_CLIPBOARD,
                  payload: { value },
                })
              }
              toggleEdit={editFunc}
            />
          ) : (
            <SamlEdit
              {...props}
              provider={p}
              samlSettings={props.core.samlSettingsByProviderId?.[p.id]!}
              key={p.id}
              cancelEdit={() =>
                setEditingSamlProviderById({
                  ...editingSamlProviderById,
                  [p.id]: false,
                })
              }
            />
          );
        })}
      </div>

      {/* SCIM */}

      <div style={{ marginTop: 34 }}>
        <h3>
          User <strong>Provisioning</strong> Provider
        </h3>
        <p>
          <ExternalLink
            to={
              "https://en.wikipedia.org/wiki/System_for_Cross-domain_Identity_Management"
            }
          >
            SCIM
          </ExternalLink>{" "}
          is supported for maintaining a pool of invitable user candidates. See
          our docs at <ExternalLink to="https://todo.com">TODO</ExternalLink>.
        </p>
        <p>
          Some features like SCIM groups are not supported. EnvKey follows the
          SCIM RFCs and has been tested with major providers.
        </p>
      </div>
      {!scimProviders.length ? (
        <div className="field">
          <label>
            <button
              className="primary"
              style={{ float: "right" }}
              disabled={Boolean(props.core.isCreatingProvisioningProvider)}
              onClick={(e) => {
                e.preventDefault();
                props.dispatch({
                  type: Client.ActionType.CREATE_SCIM_PROVISIONING_PROVIDER,
                  payload: {
                    nickname: defaultNewScimProviderName,
                    authScheme:
                      Auth.PROVISIONING_PROVIDER_AUTH_SCHEMES["bearer"],
                  },
                });
              }}
            >
              {props.core.isCreatingProvisioningProvider
                ? "Creating..."
                : "Setup"}
            </button>
            SCIM Provisioning Provider
          </label>
        </div>
      ) : (
        scimProviders.map((provider) =>
          editingScimProviderById[provider.id] ? (
            <ScimEdit
              {...props}
              provider={provider}
              cancelEdit={() =>
                setEditingScimProviderById({
                  ...editingScimProviderById,
                  [provider.id]: false,
                })
              }
            />
          ) : (
            <div key={provider.id}>
              <ScimDisplay
                {...props}
                provider={provider}
                initialSecret={props.core.provisioningProviderConfig?.secret}
                copy={(value: string) =>
                  props.dispatch({
                    type: Client.ActionType.WRITE_CLIPBOARD,
                    payload: { value },
                  })
                }
                toggleEdit={() =>
                  setEditingScimProviderById({
                    ...editingScimProviderById,
                    [provider.id]: true,
                  })
                }
              />
            </div>
          )
        )
      )}
      {scimError ? (
        <p className="error">
          {"message" in scimError
            ? scimError?.message
            : "SCIM error " + scimError}
        </p>
      ) : null}
    </div>
  );
};

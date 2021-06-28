import React, { useEffect, useState } from "react";
import { OrgComponent } from "@ui_types";
import { Api, Model } from "@core/types";
import { CopyableDisplay } from "./copyable_display";
import { randomBytes } from "crypto";
import { encode as encodeBase58 } from "bs58";

export const ScimDisplay: OrgComponent<
  {},
  {
    provider: Model.ScimProvisioningProvider;
    initialSecret?: string,
    copy: (v: string) => void;
    toggleEdit: () => void;

  }
> = (props) => {
  const { provider, copy, toggleEdit, initialSecret } = props;

  const regenerateSecret = () => {
    const nextSecret = ["ekb", encodeBase58(randomBytes(20))].join("_");
    props.dispatch({
      type: Api.ActionType.UPDATE_SCIM_PROVISIONING_PROVIDER,
      payload: {
        id: provider.id,
        nickname: provider.nickname,
        authScheme: provider.authScheme,
        secret: nextSecret,
      },
    });
  };

  const secret = initialSecret ?? props.core.provisioningProviderConfig?.secret

  return (
    <div>
      <div className="field">
        <label>
          SCIM Provisioning Provider
          <button
            disabled={props.core.isUpdatingProvisioningProvider}
            className="primary"
            style={{ float: "right" }}
            onClick={(e) => {
              e.preventDefault();
              toggleEdit();
            }}
          >
            Edit
          </button>
        </label>
        <span>
          <strong>{provider.nickname}</strong>
        </span>
      </div>

      <CopyableDisplay
        label="Endpoint URL"
        value={provider.endpointBaseUrl}
        copy={copy}
      />

      <div className="field" style={{ marginTop: "34px" }}>
        <label>
          Auth Secret
          <button
            style={{ float: "right" }}
            disabled={props.core.isUpdatingProvisioningProvider}
            className="primary"
            onClick={(e) => {
              e.preventDefault();
              const c = window.confirm(
                "Create a new auth secret? The current secret will stop working immediately."
              );
              if (!c) {
                return;
              }
              regenerateSecret();
            }}
          >
            {props.core.isUpdatingProvisioningProvider
              ? "Working..."
              : "Regenerate"}
          </button>
        </label>
        <span>
          <strong>{provider.authScheme}</strong> auth scheme
        </span>
      </div>

      {secret ? (
        <CopyableDisplay
          label={
            "A new auth secret for this SCIM provider has been set. Save it now. It will not be shown again."
          }
          value={secret}
          copy={copy}
        />
      ) : null}
    </div>
  );
};

export const ScimEdit: OrgComponent<
  {},
  {
    provider: Model.ScimProvisioningProvider;
    cancelEdit: () => void;
  }
> = (props) => {
  const { dispatch, core, provider, cancelEdit } = props;
  const [forceSecret, setForceSecret] = useState<string>("");
  const [nickname, setNickname] = useState<string>(provider.nickname || "");

  return (
    <div>
      <div className="field">
        <label>
          SCIM Provider
          <button
            className="primary"
            style={{ float: "right" }}
            onClick={(e) => {
              e.preventDefault();
              cancelEdit();
            }}
          >
            Cancel Edit
          </button>
        </label>
      </div>
      <div className="field">
        <label>Provider Nickname</label>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </div>
      <div className="buttons">
        <button
          className="primary"
          disabled={props.core.isUpdatingProvisioningProvider}
          onClick={(e) => {
            e.preventDefault();
            props
              .dispatch({
                type: Api.ActionType.UPDATE_SCIM_PROVISIONING_PROVIDER,
                payload: {
                  id: provider.id,
                  nickname,
                  authScheme: provider.authScheme,
                },
              })
              .then((res) => {
                if (res.success) {
                  cancelEdit();
                }
              });
          }}
        >
          {props.core.isUpdatingProvisioningProvider ? "Saving..." : "Save"}
        </button>
      </div>

      <div className="field" style={{ marginTop: 34 }}>
        <label>Custom Secret</label>
        <span>
          We strongly recommend using the randomly generated secret provided by
          EnvKey. If that will not work, enter a custom auth secret here.
        </span>
        <input
          type="text"
          value={forceSecret}
          placeholder="Enter a strong secret..."
          onChange={(e) => setForceSecret(e.target.value)}
        />
        <div className="buttons">
          <button
            disabled={props.core.isUpdatingProvisioningProvider}
            className="primary"
            onClick={(e) => {
              e.preventDefault();
              props
                .dispatch({
                  type: Api.ActionType.UPDATE_SCIM_PROVISIONING_PROVIDER,
                  payload: {
                    id: provider.id,
                    nickname: provider.nickname,
                    authScheme: provider.authScheme,
                    secret: forceSecret,
                  },
                })
                .then((res) => {
                  if (res.success) {
                    cancelEdit();
                  }
                });
            }}
          >
            {props.core.isUpdatingProvisioningProvider
              ? "Changing..."
              : "Change Auth Secret"}
          </button>
        </div>
      </div>

      <div className="danger-zone">
        <h3>Danger Zone</h3>
        <div className="buttons">
          <button
            className="primary"
            disabled={Boolean(props.core.isDeletingProvisioningProvider)}
            onClick={(e) => {
              e.preventDefault();
              const conf = window.confirm(
                "This will completely delete the SCIM provider. Continue?"
              );
              if (!conf) {
                return;
              }
              props.dispatch({
                type: Api.ActionType.DELETE_SCIM_PROVISIONING_PROVIDER,
                payload: {
                  id: provider.id,
                },
              });
            }}
          >
            {props.core.isDeletingProvisioningProvider
              ? "Deleting..."
              : "Delete Now"}
          </button>
        </div>
        <div className="active">
          <span className="subtitle">
            Deleting the SCIM user provisioner{" "}
            <strong>{provider.nickname}</strong> will remove all the synced user
            candidates. No EnvKey Org Users will be removed.
          </span>
        </div>
      </div>
    </div>
  );
};

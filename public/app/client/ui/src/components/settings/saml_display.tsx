import React, { useState } from "react";
import { Auth, Model } from "@core/types";
import { samlIdpHasMinimumSettings } from "../../../../shared/src/saml";
import { CopyableDisplay } from "./copyable_display";

export const SamlDisplay: React.FC<{
  provider: Model.ExternalAuthProvider;
  samlSettings: Partial<Model.SamlProviderSettings>;
  copy: (v: string) => void;
  toggleEdit: () => void;
  defaultShowAll?: boolean;
}> = ({ copy, provider, samlSettings, toggleEdit, defaultShowAll }) => {
  const [isViewingSpCert, setIsViewingSpCert] = useState(
    defaultShowAll || false
  );
  const [isViewingIdpCerts, setIsViewingIdpCerts] = useState(
    defaultShowAll || false
  );
  const [isViewingMappings, setIsViewingMappings] = useState(
    defaultShowAll || false
  );

  const displaySpCert = isViewingSpCert ? (
    <div className="active">
      <CopyableDisplay
        label={"PEM"}
        value={samlSettings.serviceProviderX509Cert + ""}
        copy={copy}
        disableClasses={true}
      />
      {samlSettings.serviceProviderX509CertSha1 ? (
        <CopyableDisplay
          label={"SHA1"}
          value={samlSettings.serviceProviderX509CertSha1}
          copy={copy}
          disableClasses={true}
        />
      ) : null}
      {samlSettings.serviceProviderX509CertSha256 ? (
        <CopyableDisplay
          label={"SHA256"}
          value={samlSettings.serviceProviderX509CertSha256}
          copy={copy}
          disableClasses={true}
        />
      ) : null}{" "}
    </div>
  ) : null;

  let displayIdpCerts: any;
  if (isViewingIdpCerts) {
    displayIdpCerts = (
      <div className="active">
        {samlSettings.identityProviderX509Certs!.map((c, ix) => (
          <div>
            <CopyableDisplay
              label={"Certificate " + (ix + 1)}
              value={c + ""}
              copy={copy}
              disableClasses={true}
            />
            {samlSettings.identityProviderX509CertsSha1?.[ix] ? (
              <CopyableDisplay
                label={"SHA1"}
                value={samlSettings.identityProviderX509CertsSha1?.[ix]}
                copy={copy}
                disableClasses={true}
              />
            ) : null}
            {samlSettings.identityProviderX509CertsSha256?.[ix] ? (
              <CopyableDisplay
                label={"SHA256"}
                value={samlSettings.identityProviderX509CertsSha256?.[ix]}
                copy={copy}
                disableClasses={true}
              />
            ) : null}
          </div>
        ))}
      </div>
    );
  } else if (!samlSettings?.identityProviderX509Certs?.length) {
    displayIdpCerts = (
      <div className="subtitle">
        <div className="error">
          No identity provider certificates have been uploaded.{" "}
          <button
            className="primary"
            onClick={(e) => {
              e.preventDefault();
              toggleEdit();
            }}
          >
            Add now
          </button>{" "}
        </div>
      </div>
    );
  } else {
    displayIdpCerts = null;
  }

  const attrMappingDisplay = isViewingMappings ? (
    <div>
      <CopyableDisplay
        label={"Required IdP email MUST be mapped to SP"}
        value={
          samlSettings.serviceProviderAttributeMappings?.emailAddress || ""
        }
        copy={copy}
      />
      <CopyableDisplay
        label={"Optional IdP first name mapped to SP"}
        value={samlSettings.serviceProviderAttributeMappings?.firstName || ""}
        copy={copy}
      />
      <CopyableDisplay
        label={"Optional IdP last name mapped to SP"}
        value={samlSettings.serviceProviderAttributeMappings?.lastName || ""}
        copy={copy}
      />
    </div>
  ) : null;

  const extendedButtonSpCert = (
    <button
      className="secondary"
      onClick={(e) => {
        e.preventDefault();
        setIsViewingSpCert(!isViewingSpCert);
      }}
    >
      {isViewingSpCert ? "Hide" : "Show"}
    </button>
  );
  const extendedButtonIdpCerts = samlSettings?.identityProviderX509Certs
    ?.length ? (
    <button
      className="secondary"
      onClick={(e) => {
        e.preventDefault();
        setIsViewingIdpCerts(!isViewingIdpCerts);
      }}
    >
      {isViewingIdpCerts ? "Hide" : "Show"}
    </button>
  ) : null;
  const extendedButtonMappings = (
    <button
      className="secondary"
      onClick={(e) => {
        e.preventDefault();
        setIsViewingMappings(!isViewingMappings);
      }}
    >
      {isViewingMappings ? "Hide" : "Show"}
    </button>
  );

  return (
    <div>
      <div className="field">
        <label>
          {Auth.AUTH_PROVIDERS[provider.provider]}
          <a
            className="primary"
            style={{ float: "right" }}
            onClick={(e) => {
              e.preventDefault();
              toggleEdit();
            }}
          >
            Edit
          </a>
        </label>
        <span>
          <strong>{provider.nickname}</strong>
        </span>
      </div>
      {samlIdpHasMinimumSettings(
        samlSettings as Model.SamlProviderSettings
      ) ? null : (
        <div className="active">
          <div className="subtitle">
            <button
              className="primary"
              onClick={(e) => {
                e.preventDefault();
                toggleEdit();
              }}
            >
              Finish Setup
            </button>
            <strong>{provider.nickname}</strong> is missing Identity Provider
            (IdP) settings. Please enter all the IdP settings on this screen
            before adding users.
          </div>
        </div>
      )}

      <CopyableDisplay
        label={"(SP) Service Provider Entity ID (XML Metadata)"}
        value={samlSettings.serviceProviderEntityId || ""}
        copy={copy}
      />

      <CopyableDisplay
        label={"(SP) Service Provider Assert/ACS/Callback URL"}
        value={samlSettings.serviceProviderAcsUrl || ""}
        copy={copy}
      />

      <div className="active">
        <div className="title">
          (SP) Service Provider Certificate
          {extendedButtonSpCert}
        </div>

        {displaySpCert}
      </div>

      <CopyableDisplay
        label={"(SP) Name ID (username or email)"}
        value={samlSettings.serviceProviderNameIdFormat || ""}
        copy={copy}
      />

      <div className="active">
        <div className="title">
          (SP) Attribute Mappings
          {extendedButtonMappings}
        </div>
        {attrMappingDisplay}
      </div>

      <div className="active">
        <div className="title">Signature Algorithm</div>
        <div className="subtitle">SHA256</div>
      </div>

      {/* IDP */}

      <div className="active">
        <div className="title">(IdP) Identity Provider Known Service</div>
        <div className="subtitle">
          {samlSettings.identityProviderKnownService}
        </div>
      </div>
      <div className="active">
        <div className="title">(IdP) Identity Provider Entity ID</div>
        <div className="subtitle">
          {samlSettings.identityProviderEntityId ? (
            <span>{samlSettings.identityProviderEntityId}</span>
          ) : (
            <div className="error">
              IdP entity ID has not been added yet.{" "}
              <button
                className="primary"
                onClick={(e) => {
                  e.preventDefault();
                  toggleEdit();
                }}
              >
                Add now
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="active">
        <div className="title">(IdP) Identity Provider Login URL</div>
        <div className="subtitle">
          {samlSettings.identityProviderLoginUrl ? (
            <span>{samlSettings.identityProviderLoginUrl} </span>
          ) : (
            <div className="error">
              IdP login URL has not been added yet.{" "}
              <button
                className="primary"
                onClick={(e) => {
                  e.preventDefault();
                  toggleEdit();
                }}
              >
                Add now
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="active">
        <div className="title">
          (IdP) Identity Provider Certificates (
          {samlSettings.identityProviderX509Certs?.length || 0}){" "}
          {extendedButtonIdpCerts}
        </div>
        {displayIdpCerts}
      </div>
    </div>
  );
};

import React, { useState, useMemo, useEffect } from "react";
import { OrgComponent } from "@ui_types";
import { capitalize } from "@core/lib/utils/string";
import { Model, Api } from "@core/types";
import moment from "moment";
import * as g from "@core/lib/graph";
import * as styles from "@styles";
import { SvgImage } from "@images";
import { MIN_ACTION_DELAY_MS } from "@constants";
import { wait } from "@core/lib/utils/wait";

export const Billing: OrgComponent = (props) => {
  const { graph, graphUpdatedAt } = props.core;
  const org = g.getOrg(graph);
  const currentUserId = props.ui.loadedAccountId!;

  const {
    license,
    numActiveDevices,
    numPendingDevices,
    numActiveCliUsers,
    numActiveEnvkeys,
  } = useMemo(() => {
    const numActiveDevices = Object.values(
      g.getActiveOrgUserDevicesByUserId(graph)
    ).flat().length;
    const numActiveInvites = g.getActiveInvites(graph, props.ui.now).length;
    const numActiveGrants = g.getActiveDeviceGrants(graph, props.ui.now).length;

    return {
      license: g.graphTypes(graph).license,
      numActiveDevices,
      numPendingDevices: numActiveInvites + numActiveGrants,
      numActiveCliUsers: g.getActiveCliUsers(graph).length,
      numActiveEnvkeys: Object.values(
        g.getActiveGeneratedEnvkeysByKeyableParentId(graph)
      ).length,
    };
  }, [graphUpdatedAt, currentUserId]);

  const expiresMoment = useMemo(
    () => (license.expiresAt == -1 ? undefined : moment(license.expiresAt)),
    [JSON.stringify(license)]
  );

  const [currentLicenseId, setCurrentLicenseId] = useState(license.id);
  const [newLicense, setNewLicense] = useState("");
  const [isUpdatingLicense, setIsUpdatingLicense] = useState(false);
  const [awaitingMinDelay, setAwaitingMinDelay] = useState(false);

  const [selectedTierIndex, setSelectedTierIndex] = useState(0);
  const selectedTier = org.billingTiers
    ? org.billingTiers[selectedTierIndex]
    : undefined;

  useEffect(() => {
    if (
      isUpdatingLicense &&
      license.id != currentLicenseId &&
      !awaitingMinDelay
    ) {
      setIsUpdatingLicense(false);
      setNewLicense("");
      setCurrentLicenseId(license.id);
      for (let i = 0; i < org.billingTiers!.length; i++) {
        const tier = org.billingTiers![i];
        if (tier.maxDevices > license.maxDevices) {
          setSelectedTierIndex(i);
          break;
        }
      }
    }
  }, [license.id, awaitingMinDelay]);

  useEffect(() => {
    if (props.core.updateLicenseError && !awaitingMinDelay) {
      setIsUpdatingLicense(false);
    }
  }, [typeof props.core.updateLicenseError, awaitingMinDelay]);

  return (
    <div className={styles.Billing}>
      <div className="current-license">
        <h3>
          Current <strong>License</strong>
        </h3>
        <div className="field">
          <label>Type</label>
          <span>
            {capitalize(license.plan)}
            {license.provisional ? " (provisional)" : ""}
          </span>
        </div>
        <div className="field">
          <label>Expires</label>
          <span>
            {license.expiresAt == -1
              ? "Never"
              : expiresMoment!.format("MMMM Do, YYYY") +
                ` (${expiresMoment!.startOf("day").fromNow()})`}
          </span>
        </div>
        <div className="field">
          <label>Devices</label>

          <span>
            using {numActiveDevices + numPendingDevices}/{license.maxDevices}{" "}
            {numPendingDevices > 0 ? (
              <small>
                {" "}
                {numActiveDevices} active, {numPendingDevices} pending
              </small>
            ) : (
              ""
            )}
          </span>
        </div>
        <div className="field">
          <label>ENVKEYs</label>
          <span>
            using {numActiveEnvkeys}/{license.maxEnvkeys}
          </span>
        </div>
        <div className="field">
          <label>CLI Keys</label>

          <span>
            using {numActiveCliUsers}/{license.maxCliUsers}
          </span>
        </div>
      </div>

      <div className="upgrade-license">
        <h3>
          Upgrade Or Renew <strong>License</strong>
        </h3>

        <p>
          To upgrade or renew your license, please email{" "}
          <strong>sales@envkey.com</strong>
        </p>

        <p>
          Include your <strong>Billing Id</strong> and the{" "}
          <strong>Billing Tier</strong> that fits your organization's needs.
          EnvKey licenses are billed annually.
        </p>

        <div className="field billing-id">
          <label>Billing ID</label> <span>{org.billingId!}</span>
        </div>

        <div>
          <div className="field billing-tier">
            <label>Billing Tier</label>

            <div className="select">
              <select
                value={selectedTierIndex}
                onChange={(e) => setSelectedTierIndex(parseInt(e.target.value))}
              >
                {org.billingTiers!.map((tier, i) => (
                  <option value={i}>{tier.label}</option>
                ))}
              </select>
              <SvgImage type="down-caret" />
            </div>

            <span>
              Up to <strong>{selectedTier?.maxDevices}</strong> user devices,{" "}
              <strong>{selectedTier?.maxEnvkeys}</strong> ENVKEYs, and{" "}
              <strong>{selectedTier?.maxCliUsers}</strong> CLI keys. <br />
              <strong>Priority support.</strong>
            </span>
          </div>
        </div>

        <p>
          After receiving your email, we'll get back to you shortly with pricing
          details. If you dedice to proceed, we'll send you an invoice, a
          Service Agreement, and a provisional license. When the invoice is paid
          and the Service Agreement is signed, we'll send your full license.
        </p>

        <div className="field new-license">
          <label>Set New License</label>
          <textarea
            value={newLicense}
            disabled={isUpdatingLicense}
            onChange={(e) => setNewLicense(e.target.value)}
            placeholder="Paste license here"
          />
          {props.core.updateLicenseError && !awaitingMinDelay ? (
            <p className="error">
              Your license is invalid, expired, or could not be updated. Please
              make sure you've copied it correctly and try again. Contact{" "}
              <strong>sales@envkey.com</strong> if the problem persists.
            </p>
          ) : (
            ""
          )}
          <button
            className="primary"
            disabled={!newLicense || isUpdatingLicense}
            onClick={() => {
              setIsUpdatingLicense(true);

              setAwaitingMinDelay(true);
              wait(MIN_ACTION_DELAY_MS).then(() => setAwaitingMinDelay(false));

              props.dispatch({
                type: Api.ActionType.UPDATE_LICENSE,
                payload: { signedLicense: newLicense },
              });
            }}
          >
            {isUpdatingLicense ? "Updating..." : "Update License"}
          </button>
        </div>
      </div>
    </div>
  );
};

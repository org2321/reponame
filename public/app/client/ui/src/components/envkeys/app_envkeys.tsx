import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { OrgComponent } from "@ui_types";
import { Client, Model, Api, Rbac } from "@core/types";
import * as g from "@core/lib/graph";
import * as R from "ramda";
import { twitterShortTs } from "@core/lib/utils/date";
import { capitalizeAll } from "humanize-plus";
import humanize from "humanize-string";
import { style } from "typestyle";
import * as styles from "@styles";
import { SvgImage, SmallLoader } from "@images";
import { MIN_ACTION_DELAY_MS } from "@constants";
import { wait } from "@core/lib/utils/wait";

const getAppEnvkeysComponent = (
  keyableParentType: Model.KeyableParent["type"]
) => {
  const AppEnvkeys: OrgComponent<{ appId: string }> = (props) => {
    const { graph, graphUpdatedAt } = props.core;
    const currentUserId = props.ui.loadedAccountId!;
    const currentAccount = props.core.orgUserAccounts[currentUserId]!;
    const appId = props.routeParams.appId;
    const now = props.ui.now;

    const {
      baseEnvironments,
      keyableParentsByEnvironmentId,
      generatedEnvkeysByKeyableParentId,
      subEnvironmentsByParentEnvironmentId,
    } = useMemo(() => {
      let baseEnvironments = g.authz.getVisibleBaseEnvironments(
        graph,
        currentUserId,
        appId
      );

      baseEnvironments = baseEnvironments.filter(({ environmentRoleId }) => {
        const role = graph[environmentRoleId] as Rbac.EnvironmentRole;
        return keyableParentType == "localKey"
          ? role.hasLocalKeys
          : role.hasServers;
      });

      const keyableParentsByEnvironmentId =
        keyableParentType == "localKey"
          ? R.mapObjIndexed(
              (localKeys) =>
                localKeys
                  ? localKeys.filter(R.propEq("userId", currentUserId))
                  : localKeys,
              g.getLocalKeysByEnvironmentId(graph)
            )
          : g.getServersByEnvironmentId(graph);

      return {
        baseEnvironments,
        keyableParentsByEnvironmentId,
        generatedEnvkeysByKeyableParentId: g.getActiveGeneratedEnvkeysByKeyableParentId(
          graph
        ),
        subEnvironmentsByParentEnvironmentId: g.getSubEnvironmentsByParentEnvironmentId(
          graph
        ),
      };
    }, [graphUpdatedAt, currentUserId, appId]);

    const [license, numActive] = useMemo(
      () => [
        g.graphTypes(graph).license,
        Object.values(g.getActiveGeneratedEnvkeysByKeyableParentId(graph))
          .length,
      ],
      [graphUpdatedAt, currentUserId]
    );
    const licenseExpired =
      license.expiresAt != -1 && props.ui.now > license.expiresAt;

    const showEnvironmentLabel = !(
      keyableParentType == "localKey" && baseEnvironments.length == 1
    );

    const [showForm, setShowForm] = useState(false);
    const [formParentEnvironmentId, setFormParentEnvironmentId] = useState(
      baseEnvironments.length == 1 ? baseEnvironments[0].id : ""
    );
    const [formSubEnvironmentId, setFormSubEnvironmentId] = useState("");

    const formEnvironmentId = formSubEnvironmentId || formParentEnvironmentId;
    const existingKeyableParents =
      keyableParentsByEnvironmentId[formEnvironmentId] ?? [];

    const [formName, setFormName] = useState("");

    const [isCreating, setIsCreating] = useState(false);
    const [removingId, setRemovingId] = useState<string>();
    const [regeneratingId, setRegeneratingId] = useState<string>();

    const [confirming, setConfirming] = useState<{
      id: string;
      type: "remove" | "revoke" | "regen";
    }>();

    const [copiedId, setCopiedId] = useState("");

    useEffect(() => {
      return () => {
        props.dispatch({
          type: Client.ActionType.CLEAR_ALL_GENERATED_ENVKEYS,
        });
      };
    }, []);

    useEffect(() => {
      if (formEnvironmentId && existingKeyableParents.length == 0) {
        setFormName(
          `Default ${
            keyableParentType == "server"
              ? g.getEnvironmentName(graph, formEnvironmentId) + " Server"
              : "Local Key"
          }`
        );
      } else {
        setFormName("");
      }
    }, [formEnvironmentId]);

    useEffect(() => {
      if (removingId) {
        for (let environmentId in keyableParentsByEnvironmentId) {
          for (let keyableParent of keyableParentsByEnvironmentId[
            environmentId
          ] ?? []) {
            if (removingId == keyableParent.id) {
              return;
            }
          }
        }
        setRemovingId(undefined);
      }
    }, [keyableParentsByEnvironmentId]);

    useEffect(() => {
      if (regeneratingId && props.core.generatedEnvkeys[regeneratingId]) {
        setRegeneratingId(undefined);
      }
    }, [Object.keys(props.core.generatedEnvkeys).length]);

    const renderForm = () => {
      if (!showForm) {
        return "";
      }

      if (numActive >= license.maxEnvkeys) {
        return "";
      }

      return (
        <form>
          {baseEnvironments.length > 1 ? (
            <div className="field">
              <label>Environment</label>
              <div className="select">
                <select
                  value={formParentEnvironmentId}
                  onChange={(e) => setFormParentEnvironmentId(e.target.value)}
                >
                  {[
                    <option value={""} disabled>
                      Select an environment
                    </option>,
                    ...baseEnvironments.map((environment) => (
                      <option value={environment.id}>
                        {g.getEnvironmentName(graph, environment.id)}
                      </option>
                    )),
                  ]}
                </select>
                <SvgImage type="down-caret" />
              </div>
            </div>
          ) : (
            ""
          )}

          {formParentEnvironmentId &&
          subEnvironmentsByParentEnvironmentId[formParentEnvironmentId] ? (
            <div className="field">
              <label>Sub-Environment</label>
              <div className="select">
                <select
                  value={formSubEnvironmentId}
                  onChange={(e) => setFormSubEnvironmentId(e.target.value)}
                >
                  {[
                    <option value={""}>Base environment</option>,
                    ...subEnvironmentsByParentEnvironmentId[
                      formParentEnvironmentId
                    ]!.map((environment) => (
                      <option value={environment.id}>
                        {g.getEnvironmentName(graph, environment.id)}
                      </option>
                    )),
                  ]}
                </select>
                <SvgImage type="down-caret" />
              </div>
            </div>
          ) : (
            ""
          )}

          {formParentEnvironmentId ? (
            <div className="field">
              <label>Name</label>
              <input
                type="text"
                autoFocus={true}
                value={formName}
                placeholder="Enter a name..."
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
          ) : (
            ""
          )}

          <div className="buttons">
            <button className="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={
                isCreating || !formParentEnvironmentId || !formName.trim()
              }
              onClick={async (e) => {
                e.preventDefault();
                setIsCreating(true);
                await props.dispatch({
                  type:
                    keyableParentType == "localKey"
                      ? Client.ActionType.CREATE_LOCAL_KEY
                      : Client.ActionType.CREATE_SERVER,
                  payload: {
                    appId,
                    name: formName,
                    environmentId: formEnvironmentId,
                  },
                });
                setShowForm(false);
                setIsCreating(false);
                setFormName("");
                setFormParentEnvironmentId("");
                setFormSubEnvironmentId("");
              }}
            >
              {isCreating ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      );
    };

    const renderRemove = (keyableParent: Model.KeyableParent) => {
      if (
        !(
          (keyableParent.type == "localKey" &&
            g.authz.canDeleteLocalKey(
              graph,
              currentUserId,
              keyableParent.id
            )) ||
          (keyableParent.type == "server" &&
            g.authz.canDeleteServer(graph, currentUserId, keyableParent.id))
        )
      ) {
        return "";
      }

      return (
        <span
          className="delete"
          onClick={() =>
            setConfirming({ id: keyableParent.id, type: "remove" })
          }
        >
          <SvgImage type="x" />
          <span>Remove</span>
        </span>
      );
    };

    // const renderRevoke = (generated: Model.GeneratedEnvkey) => {
    //   if (
    //     !g.authz.canRevokeKey(graph, currentUserId, {
    //       generatedEnvkeyId: generated.id,
    //     })
    //   ) {
    //     return "";
    //   }

    //   return (
    //     <span
    //       onClick={() =>
    //         setConfirming({ id: generated.keyableParentId, type: "revoke" })
    //       }
    //     >
    //       Revoke
    //     </span>
    //   );
    // };

    const renderRegenerate = (generated: Model.GeneratedEnvkey) => {
      if (
        !g.authz.canRevokeKey(graph, currentUserId, {
          generatedEnvkeyId: generated.id,
        })
      ) {
        return "";
      }

      return (
        <span
          className="regen"
          onClick={() =>
            setConfirming({ id: generated.keyableParentId, type: "regen" })
          }
        >
          <SvgImage type="restore" />
          <span>Regenerate</span>
        </span>
      );
    };

    const renderConfirm = (keyableParent: Model.KeyableParent) => {
      let label = "";
      if (!confirming) {
        return;
      }

      if (confirming.type == "remove") {
        label += "Remove " + capitalizeAll(humanize(keyableParentType));
      } else if (confirming.type == "revoke") {
        label += "Revoke ENVKEY";
      } else if (confirming.type == "regen") {
        label += "Regenerate ENVKEY";
      }
      label += "?";

      const generated = generatedEnvkeysByKeyableParentId[keyableParent.id];

      return (
        <div className="actions confirm">
          <label>{label}</label>
          <span>
            <button
              className="secondary"
              onClick={() => setConfirming(undefined)}
            >
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => {
                if (confirming.type == "remove") {
                  setRemovingId(keyableParent.id);

                  props.dispatch({
                    type:
                      keyableParentType == "localKey"
                        ? Api.ActionType.DELETE_LOCAL_KEY
                        : Api.ActionType.DELETE_SERVER,
                    payload: { id: keyableParent.id },
                  });
                } else if (confirming.type == "revoke") {
                  props.dispatch({
                    type: Api.ActionType.REVOKE_KEY,
                    payload: { id: generated!.id },
                  });
                } else if (confirming.type == "regen") {
                  setRegeneratingId(keyableParent.id);

                  props.dispatch({
                    type: Client.ActionType.GENERATE_KEY,
                    payload: {
                      appId,
                      keyableParentId: keyableParent.id,
                      keyableParentType: keyableParent.type,
                    },
                  });
                }
                setConfirming(undefined);
              }}
            >
              Confirm
            </button>
          </span>
        </div>
      );
    };

    const renderActions = (keyableParent: Model.KeyableParent) => {
      const justGenerated = props.core.generatedEnvkeys[keyableParent.id];
      if (justGenerated) {
        return (
          <div className="actions">
            <button
              className="primary"
              onClick={() => {
                const envkeyParts = [
                  justGenerated.envkeyIdPart,
                  justGenerated.encryptionKey,
                ];

                if (currentAccount.hostType == "self-hosted") {
                  envkeyParts.push(currentAccount.hostUrl);
                }

                setCopiedId(keyableParent.id);
                props.dispatch({
                  type: Client.ActionType.WRITE_CLIPBOARD,
                  payload: {
                    value: envkeyParts.join("-"),
                  },
                });
              }}
            >
              Copy ENVKEY
            </button>
            <button
              className="secondary"
              onClick={() => {
                props.dispatch({
                  type: Client.ActionType.CLEAR_GENERATED_ENVKEY,
                  payload: { keyableParentId: keyableParent.id },
                });
              }}
            >
              Done
            </button>
          </div>
        );
      }

      if ((removingId ?? regeneratingId) == keyableParent.id) {
        return (
          <div className="actions">
            <SmallLoader />
          </div>
        );
      }

      if (confirming?.id == keyableParent.id) {
        return renderConfirm(keyableParent);
      }

      const content: React.ReactNode[] = [renderRemove(keyableParent)];

      const generated = generatedEnvkeysByKeyableParentId[keyableParent.id];

      if (generated) {
        content.push(/*renderRevoke(generated),*/ renderRegenerate(generated));
      } else if (!(numActive >= license.maxEnvkeys || licenseExpired)) {
        content.push(
          <button
            onClick={() => {
              props.dispatch({
                type: Client.ActionType.GENERATE_KEY,
                payload: {
                  appId,
                  keyableParentId: keyableParent.id,
                  keyableParentType: keyableParent.type,
                },
              });
            }}
          >
            Generate
          </button>
        );
      }

      return (
        <div
          className={
            "actions" + (removingId || regeneratingId ? " disabled" : "")
          }
        >
          {content}
        </div>
      );
    };

    const renderEnvkey = (keyableParent: Model.KeyableParent) => {
      const generated = generatedEnvkeysByKeyableParentId[keyableParent.id];
      const justGenerated = props.core.generatedEnvkeys[keyableParent.id];

      if (justGenerated || generated) {
        return (
          <span className="envkey">
            ENVKEY=
            {justGenerated
              ? justGenerated.envkeyIdPart.slice(0, 10)
              : generated!.envkeyShort}
            …
            {justGenerated && copiedId == keyableParent.id ? (
              <small>Copied.</small>
            ) : (
              ""
            )}
          </span>
        );
      } else {
        return <span>No ENVKEY generated.</span>;
      }
    };

    const renderKeyableParent = (keyableParent: Model.KeyableParent) => {
      const justGenerated = props.core.generatedEnvkeys[keyableParent.id];

      const generated = generatedEnvkeysByKeyableParentId[keyableParent.id];

      const generatedBy = generated
        ? (graph[generated.creatorId] as Model.OrgUser | Model.CliUser)
        : undefined;

      return (
        <div className={justGenerated ? "generated-envkey" : ""}>
          <div>
            <span className="title">{keyableParent.name}</span>
            {generated && generatedBy ? (
              <span className="subtitle">
                {generatedBy.id == currentUserId
                  ? "you"
                  : g.getUserName(graph, generatedBy.id, true)}
                <span className="sep">{"●"}</span>
                {twitterShortTs(generated.createdAt, now)}
              </span>
            ) : (
              ""
            )}
          </div>

          {justGenerated ? (
            <div className="generated-envkey-copy">
              <label>ENVKEY Generated</label>
              <p>
                {keyableParentType == "localKey"
                  ? "Paste it into a .env file (ignored from source control) in your project's root directory."
                  : "Set it as an environment variable on your server."}
              </p>
            </div>
          ) : (
            ""
          )}

          <div>
            {renderEnvkey(keyableParent)}
            {renderActions(keyableParent)}
          </div>
        </div>
      );
    };

    const renderEnvironmentSection = (environment: Model.Environment) => {
      const keyableParents = (keyableParentsByEnvironmentId[environment.id] ??
        []) as Model.KeyableParent[];
      const subEnvironments =
        subEnvironmentsByParentEnvironmentId[environment.id] ?? [];

      const environmentRole = graph[
        environment.environmentRoleId
      ] as Rbac.EnvironmentRole;
      const label = environmentRole.name + " Server";

      return (
        <div>
          {showEnvironmentLabel ? <h4>{label}s</h4> : ""}
          {keyableParents.length > 0 ? (
            <div className="assoc-list">
              {keyableParents.map(renderKeyableParent)}
            </div>
          ) : (
            ""
          )}

          {keyableParentType == "server" && keyableParents.length == 0 ? (
            <div className="field empty-placeholder">
              <span>No {label} Keys have been generated.</span>
            </div>
          ) : (
            ""
          )}

          {keyableParentType == "server" && subEnvironments.length > 0
            ? subEnvironments.map(renderSubEnvironmentSection)
            : ""}
        </div>
      );
    };

    const renderSubEnvironmentSection = (subEnvironment: Model.Environment) => {
      const keyableParents = (keyableParentsByEnvironmentId[
        subEnvironment.id
      ] ?? []) as Model.KeyableParent[];

      const label = g.getEnvironmentName(graph, subEnvironment.id);
      const role = graph[
        subEnvironment.environmentRoleId
      ] as Rbac.EnvironmentRole;

      return (
        <div className="sub-environments">
          <h5>
            <span>
              {/* <SvgImage type="subenvs" /> */}
              <span className="base">
                {role.name}
                <span className="sep">→</span>
              </span>
              {label}
            </span>

            {/* <small>Sub-Environment</small> */}
          </h5>

          <div className="assoc-list">
            {keyableParents.map(renderKeyableParent)}
          </div>

          {keyableParentType == "server" && keyableParents.length == 0 ? (
            <div className="field empty-placeholder">
              <span>No {label} Server Keys have been generated.</span>
            </div>
          ) : (
            ""
          )}
        </div>
      );
    };

    const renderCreate = () => {
      if (numActive >= license.maxEnvkeys || licenseExpired) {
        const blockStatement = licenseExpired
          ? [
              `Your organization's ${
                license.provisional ? "provisional " : ""
              }license has `,
              <strong>expired.</strong>,
            ]
          : [
              "Your organization has reached its limit of ",
              <strong>{license.maxEnvkeys} ENVKEYs.</strong>,
            ];

        return (
          <div>
            <p>{blockStatement}</p>
            {g.authz.hasOrgPermission(
              graph,
              currentUserId,
              "org_manage_billing"
            ) ? (
              [
                <p>
                  To generate more{" "}
                  {keyableParentType == "localKey" ? "Local Keys" : "Servers"},{" "}
                  {licenseExpired ? "renew" : "upgrade"} your org's license.
                </p>,
                <div className="buttons">
                  <Link
                    className="primary"
                    to={props.orgRoute("/my-org/billing")}
                  >
                    Go To Billing →
                  </Link>
                </div>,
              ]
            ) : (
              <p>
                To invite someone else, ask an admin to{" "}
                {licenseExpired ? "renew" : "upgrade"} your org's license.
              </p>
            )}
          </div>
        );
      }

      return (
        <div className="buttons">
          <button className="primary" onClick={() => setShowForm(true)}>
            Generate New {capitalizeAll(humanize(keyableParentType))}
            {keyableParentType == "server" ? " Key" : ""}
          </button>
        </div>
      );
    };

    return (
      <div>
        <div>{showForm ? renderForm() : renderCreate()}</div>
        <div>{baseEnvironments.map(renderEnvironmentSection)}</div>
      </div>
    );
  };

  return AppEnvkeys;
};

export const AppLocalEnvkeys = getAppEnvkeysComponent("localKey");
export const AppServerEnvkeys = getAppEnvkeysComponent("server");

import React, { useState, useEffect, useMemo } from "react";
import { EnvManagerComponent } from "@ui_types";
import { Link } from "react-router-dom";
import { Model, Rbac } from "@core/types";
import * as g from "@core/lib/graph";
import * as R from "ramda";
import { style } from "typestyle";
import { getEnvParentPath, getLocalsPath } from "@ui_lib/paths";
import * as styles from "@styles";
import { color } from "csx";
import { SvgImage } from "@images";
import { CLEARED_EDIT_STATE } from "./entry_form";
import { getEnvsUiPermissions } from "@ui_lib/envs";

export const LabelRow: EnvManagerComponent = (props) => {
  const { showLeftNav, showRightNav } = props;
  const { graph } = props.core;
  const currentUserId = props.ui.loadedAccountId!;
  const envParent = graph[props.envParentId] as Model.EnvParent;

  const envParentPath = getEnvParentPath(envParent);

  let numSubEnvironments =
    props.isSub && props.parentEnvironmentId
      ? (
          g.getSubEnvironmentsByParentEnvironmentId(graph)[
            props.parentEnvironmentId
          ] ?? []
        ).length
      : 0;
  const selectedNewSub = props.routeParams.subEnvironmentId == "new";
  let fullWidthSelectedNewSub = false;
  let selectedLocals = false;

  if (props.isSub && props.parentEnvironmentId) {
    const parentEnvironment = graph[
      props.parentEnvironmentId
    ] as Model.Environment;
    const environmentRole = graph[
      parentEnvironment.environmentRoleId
    ] as Rbac.EnvironmentRole;

    const maybeSubEnvironment = props.routeParams.subEnvironmentId
      ? (graph[props.routeParams.subEnvironmentId] as
          | Model.Environment
          | undefined)
      : undefined;

    selectedLocals = Boolean(
      !maybeSubEnvironment &&
        props.routeParams.subEnvironmentId &&
        environmentRole.hasLocalKeys &&
        !selectedNewSub
    );

    if (numSubEnvironments == 0 && !environmentRole.hasLocalKeys) {
      if (!environmentRole.hasLocalKeys) {
        fullWidthSelectedNewSub = true;
      }
    }
  }

  const [showingMenu, setShowingMenu] = useState<string>();

  const envsUiPermissions = useMemo(
    () =>
      getEnvsUiPermissions(
        props.core.graph,
        props.ui.loadedAccountId!,
        props.envParentId,
        props.visibleEnvironmentIds,
        props.localsUserId
      ),
    [
      props.ui.loadedAccountId,
      JSON.stringify(props.visibleEnvironmentIds),
      props.core.graphUpdatedAt,
    ]
  );

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      const environmentMenu = (e.target as HTMLElement).closest(
        ".environment-menu"
      );
      if (environmentMenu) {
        return;
      }
      setShowingMenu(undefined);
    };

    document.documentElement.addEventListener("click", fn);
    return () => {
      document.documentElement.removeEventListener("click", fn);
    };
  }, []);

  const renderBackLink = (environmentId: string) => {
    if (props.routeParams.environmentId) {
      return (
        <Link
          className="arrow"
          to={props.orgRoute(envParentPath + `/environments`)}
        >
          {"←"}
        </Link>
      );
    }
  };

  const renderLocalsOption = (user: Model.OrgUser | Model.CliUser) => (
    <option value={user.id}>{g.getUserName(graph, user.id)}</option>
  );

  const renderLocalsSelect = (
    orgUserCollaborators: Model.OrgUser[],
    cliKeyCollaborators: Model.CliUser[],
    localsUserId: string
  ) => {
    const orgUserOpts = orgUserCollaborators.map(renderLocalsOption);
    const cliKeyOpts = cliKeyCollaborators.map(renderLocalsOption);

    let opts: React.ReactNode;

    if (cliKeyCollaborators.length > 0) {
      opts = [
        <optgroup label="Users">{orgUserOpts}</optgroup>,
        <optgroup label="CLI Keys">{cliKeyOpts}</optgroup>,
      ];
    } else {
      opts = orgUserOpts;
    }

    return [
      <select
        value={localsUserId}
        onChange={(e) => {
          const selectedUserId = e.target.value;

          props.history.push(
            props.orgRoute(
              getLocalsPath(
                envParent,
                props.parentEnvironmentId!,
                selectedUserId
              )
            )
          );
        }}
      >
        {opts}
      </select>,

      <SvgImage type="down-caret" />,
    ];
  };

  const renderSubLink = (environmentId: string) => {
    const environment = graph[environmentId] as Model.Environment | undefined;
    const environmentRole = environment
      ? (graph[environment.environmentRoleId] as Rbac.EnvironmentRole)
      : undefined;

    const isLocals = !environment;

    const subEnvironments =
      g.getSubEnvironmentsByParentEnvironmentId(graph)[environmentId] ?? [];

    if (
      !isLocals &&
      !environmentRole?.hasLocalKeys &&
      (!(
        g.authz.canReadSubEnvs(graph, currentUserId, environmentId) ||
        g.authz.canReadSubEnvsMeta(graph, currentUserId, environmentId)
      ) ||
        (subEnvironments.length == 0 &&
          !g.authz.canCreateSubEnvironment(
            graph,
            currentUserId,
            environmentId
          )))
    ) {
      return props.routeParams.environmentId ? (
        ""
      ) : (
        <span className="subenvs spacer" />
      );
    }

    return props.isSub || isLocals ? (
      ""
    ) : (
      <Link
        className="subenvs"
        to={props.orgRoute(
          envParentPath + `/environments/${environmentId}/sub-environments`
        )}
      >
        <SvgImage type="subenvs" />

        {/* <span className="num">{subEnvironments.length}</span> */}
      </Link>
    );
  };

  const renderLabelCell = (environmentId: string, i: number) => {
    const environment = graph[environmentId] as Model.Environment | undefined;
    const toRenderId =
      environment && environment.isSub
        ? (graph[environment.parentEnvironmentId] as Model.Environment).id
        : environmentId;

    if (!environment) {
      const [envParentId, localsUserId] = environmentId.split("|");
      if (
        !envParentId ||
        envParentId != props.envParentId ||
        !localsUserId ||
        !(graph[envParentId] && graph[localsUserId])
      ) {
        return <div className="cell" key={i}></div>;
      }
    }

    let canUpdate: boolean;
    let canRead: boolean;
    let localsUserId: string | undefined;

    if (environment) {
      ({ canUpdate, canRead } = envsUiPermissions[environmentId]);
    } else {
      const split = environmentId.split("|");
      localsUserId = split[1];

      canRead = g.authz.canReadLocals(
        graph,
        currentUserId,
        props.envParentId,
        localsUserId!
      );
      canUpdate = g.authz.canUpdateLocals(
        graph,
        currentUserId,
        props.envParentId,
        localsUserId!
      );
    }

    const lockImg = canUpdate && canRead ? "" : <SvgImage type="lock" />;

    let title: React.ReactNode;

    if (props.visibleEnvironmentIds.length > 1) {
      title = (
        <Link
          className="title"
          to={props.orgRoute(envParentPath + `/environments/${toRenderId}`)}
        >
          <span>
            {lockImg}
            {g.getEnvironmentName(props.core.graph, toRenderId)}
          </span>
        </Link>
      );
    } else {
      let localsSelect: React.ReactNode;

      if (localsUserId) {
        const orgUserCollaborators =
          props.envParentType == "app"
            ? g.authz.getLocalsReadableAppCollaborators(
                graph,
                currentUserId,
                props.envParentId,
                "orgUser"
              )
            : g.authz.getLocalsReadableBlockCollaborators(
                graph,
                currentUserId,
                props.envParentId,
                "orgUser"
              );

        const cliKeyCollaborators =
          props.envParentType == "app"
            ? g.authz.getLocalsReadableAppCollaborators(
                graph,
                currentUserId,
                props.envParentId,
                "cliUser"
              )
            : g.authz.getLocalsReadableBlockCollaborators(
                graph,
                currentUserId,
                props.envParentId,
                "cliUser"
              );

        if (orgUserCollaborators.length + cliKeyCollaborators.length > 1) {
          localsSelect = renderLocalsSelect(
            orgUserCollaborators,
            cliKeyCollaborators,
            localsUserId
          );
        }
      }

      title = (
        <span className={"title" + (localsSelect ? " locals-select" : "")}>
          <span>
            {lockImg}
            {g.getEnvironmentName(props.core.graph, toRenderId)}
            {localsSelect}
          </span>
        </span>
      );
    }

    return (
      <div
        className={
          "cell" +
          (showingMenu == environmentId ? " menu-open" : "") +
          " " +
          style({
            width: `${(1 / props.visibleEnvironmentIds.length) * 100}%`,
            background: color(styles.colors.DARKER_BLUE)
              .lighten(0.075 * i)
              .toHexString(),
          })
        }
        key={i}
      >
        {renderBackLink(toRenderId)}

        {renderSubLink(toRenderId)}

        {title}

        {props.routeParams.environmentId && !props.isSub ? (
          <span className="subenvs spacer" />
        ) : (
          ""
        )}

        {canRead &&
        !(props.isSub && numSubEnvironments == 0 && !localsUserId) ? (
          <button
            className="menu"
            onClick={(e) => {
              e.stopPropagation();
              setShowingMenu(showingMenu ? undefined : environmentId);
            }}
          >
            <span>…</span>
          </button>
        ) : (
          <span className="menu spacer" />
        )}

        {showingMenu == environmentId ? (
          <div className="environment-menu">
            {canUpdate ? (
              <div
                onClick={() => {
                  setShowingMenu(undefined);
                  props.history.push(
                    props.location.pathname +
                      `?importEnvironmentId=${environmentId}`
                  );
                }}
              >
                Import
              </div>
            ) : (
              ""
            )}
            {canRead ? (
              <div
                onClick={() => {
                  setShowingMenu(undefined);
                  props.history.push(
                    props.location.pathname +
                      `?exportEnvironmentId=${environmentId}`
                  );
                }}
              >
                Export
              </div>
            ) : (
              ""
            )}
          </div>
        ) : (
          ""
        )}
      </div>
    );
  };

  const renderAdd = () => {
    let canAdd = false;
    for (let environmentId of props.isSub
      ? props.visibleEnvironmentIds
      : props.allEnvironmentIds) {
      const environment = graph[environmentId] as Model.Environment | undefined;
      if (environment) {
        if (g.authz.canUpdateEnv(graph, currentUserId, environmentId)) {
          canAdd = true;
          break;
        }
      } else {
        const [envParentId, localsUserId] = environmentId.split("|");
        canAdd = g.authz.canUpdateLocals(
          graph,
          currentUserId,
          envParentId,
          localsUserId
        );
      }
    }

    if (!canAdd) {
      return "";
    }

    return (
      <button
        className={"add" + (props.ui.envManager.showAddForm ? " selected" : "")}
        onClick={(e) => {
          e.stopPropagation();
          if (props.ui.envManager.showAddForm) {
            props.setEnvManagerState({
              showAddForm: undefined,
              entryForm: CLEARED_EDIT_STATE,
            });
          } else {
            props.setEnvManagerState({
              showAddForm: true,
              entryForm: CLEARED_EDIT_STATE,
              confirmingDeleteEntryKeyComposite: undefined,
              editingEntryKey: undefined,
              editingEnvironmentId: undefined,
              editingInputVal: undefined,
              clickedToEdit: undefined,
            });
          }
        }}
      >
        <SvgImage type="add" />
      </button>
    );
  };

  const renderActionCell = () => {
    if (
      props.isSub &&
      ((numSubEnvironments == 0 && !selectedLocals) || selectedNewSub)
    ) {
      return "";
    }

    if (props.ui.envManager.showFilter) {
      return (
        <div
          className={
            "entry-col " +
            "filtering " +
            style({
              width: `${styles.layout.ENTRY_COL_PCT * 100}%`,
              minWidth: styles.layout.ENTRY_COL_MIN_WIDTH,
              maxWidth: styles.layout.ENTRY_COL_MAX_WIDTH,
            })
          }
        >
          <div>
            <span className="search">
              <SvgImage type="search" />
            </span>

            <input
              type="text"
              autoFocus={true}
              value={props.ui.envManager.filter ?? ""}
              placeholder="Filter vars..."
              onChange={(e) => {
                if (!props.ui.envManager && e.target.value.trim()) {
                  props.setEnvManagerState({
                    filter: e.target.value,
                    showBlocks: true,
                  });
                } else if (props.ui.envManager.filter && e.target.value == "") {
                  props.setEnvManagerState({
                    filter: e.target.value,
                    showBlocks: props.ui.envManager.userSetShowBlocks ?? false,
                  });
                } else {
                  props.setEnvManagerState({
                    filter: e.target.value,
                  });
                }
              }}
            />

            <button
              className="close"
              onClick={(e) => {
                props.setEnvManagerState({
                  filter: undefined,
                  showFilter: false,
                  showBlocks: props.ui.envManager.userSetShowBlocks ?? false,
                });
              }}
            >
              <SvgImage type="x" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        className={
          "entry-col " +
          style({
            width: `${styles.layout.ENTRY_COL_PCT * 100}%`,
            minWidth: styles.layout.ENTRY_COL_MIN_WIDTH,
            maxWidth: styles.layout.ENTRY_COL_MAX_WIDTH,
          })
        }
      >
        <div>
          <label>Vars</label>
          <div className="actions">
            <button
              className="search"
              onClick={(e) => {
                props.setEnvManagerState({ showFilter: true });
              }}
            >
              <SvgImage type="search" />
            </button>

            <span
              className={
                "toggle mask-toggle" +
                (props.ui.envManager.hideValues ? " checked" : "")
              }
              onClick={() =>
                props.setEnvManagerState({
                  hideValues: props.ui.envManager.hideValues ? undefined : true,
                })
              }
            >
              <input
                type="checkbox"
                checked={props.ui.envManager.hideValues ?? false}
              />
              <SvgImage type="hide" />
            </span>

            {renderAdd()}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className={
        styles.EnvLabelRow +
        " " +
        style({
          width: `calc(100% - ${
            props.ui.sidebarWidth +
            (props.isSub && !fullWidthSelectedNewSub ? props.entryColWidth : 0)
          }px)`,
          height: props.labelRowHeight,
        })
      }
    >
      {renderActionCell()}

      {showLeftNav ? (
        <span
          className="arrow envs-nav left"
          onClick={() =>
            props.setEnvManagerState({
              environmentStartIndex:
                props.ui.envManager.environmentStartIndex - 1,
            })
          }
        >
          ←
        </span>
      ) : (
        ""
      )}

      <div className="val-cols">
        {props.visibleEnvironmentIds.map(renderLabelCell)}
      </div>

      {showRightNav ? (
        <span
          className="arrow envs-nav right"
          onClick={() =>
            props.setEnvManagerState({
              environmentStartIndex:
                props.ui.envManager.environmentStartIndex + 1,
            })
          }
        >
          →
        </span>
      ) : (
        ""
      )}
    </div>
  );
};

import React, { useState, useEffect, useMemo } from "react";
import { OrgComponent } from "@ui_types";
import { NewEnvParentImporter } from "@ui";
import { Api, Model, Client } from "@core/types";
import { capitalize } from "@core/lib/utils/string";
import { RadioGroup, Radio } from "react-radio-group";
import * as R from "ramda";
import * as g from "@core/lib/graph";
import * as styles from "@styles";
import { MIN_ACTION_DELAY_MS } from "@constants";
import { wait } from "@core/lib/utils/wait";

export const getNewEnvParentComponent = (
  envParentType: Model.EnvParent["type"]
) => {
  const NewEnvParent: OrgComponent<{}, {}> = (props) => {
    const { dispatch, core, history, orgRoute } = props;
    const { graph, graphUpdatedAt } = core;

    const {
      importableEnvironmentRoles,
      importableEnvironmentRoleIds,
      importableEnvironmentRoleIdsSet,
    } = useMemo(() => {
      const importableEnvironmentRoles = g
        .graphTypes(graph)
        .environmentRoles.filter(R.prop("defaultAllApps"));

      const importableEnvironmentRoleIds = importableEnvironmentRoles.map(
        R.prop("id")
      );

      return {
        importableEnvironmentRoles,
        importableEnvironmentRoleIds,
        importableEnvironmentRoleIdsSet: new Set(importableEnvironmentRoleIds),
      };
    }, [graphUpdatedAt]);

    const [name, setName] = useState("");
    const [createdId, setCreatedId] = useState<string>();
    const [willImport, setWillImport] = useState(false);
    const [awaitingMinDelay, setAwaitingMinDelay] = useState(false);

    const parsedHook = useState<
      Record<string, Record<string, string> | undefined>
    >({});
    const [
      parsedByEnvironmentRoleId,
      setParsedByEnvironmentRoleId,
    ] = parsedHook;

    const validHook = useState<Record<string, boolean | undefined>>({});
    const [validByEnvironmentRoleId, setValidByEnvironmentRoleId] = validHook;

    const valueHook = useState<Record<string, string>>({});
    const [valuesByEnvironmentRoleId, setValuesByEnvironmentRoleId] = valueHook;

    useEffect(() => {
      for (let [obj, setFn] of [parsedHook, validHook, valueHook]) {
        const toRemove: string[] = [];
        for (let id in obj) {
          if (!importableEnvironmentRoleIdsSet.has(id)) {
            toRemove.push(id);
          }
        }
        if (toRemove.length > 0) {
          setFn(R.omit(toRemove, obj));
        }
      }

      const toSetValid: Record<string, boolean | undefined> = {};
      const toSetValue: Record<string, string> = {};

      for (let id of importableEnvironmentRoleIds) {
        if (typeof valuesByEnvironmentRoleId[id] == "undefined") {
          toSetValue[id] = "";
        }
      }

      if (!R.isEmpty(toSetValid)) {
        setValidByEnvironmentRoleId({
          ...validByEnvironmentRoleId,
          ...toSetValid,
        });
      }

      if (!R.isEmpty(toSetValue)) {
        setValuesByEnvironmentRoleId({
          ...valuesByEnvironmentRoleId,
          ...toSetValue,
        });
      }
    }, [importableEnvironmentRoles]);

    useEffect(() => {
      props.setUiState({
        creatingEnvParent: undefined,
        importingNewEnvParentId: undefined,
      });

      return () => {
        props.setUiState({
          creatingEnvParent: undefined,
          importingNewEnvParentId: undefined,
        });
      };
    }, []);

    const createdEnvParent = createdId
      ? (graph[createdId] as Model.EnvParent | undefined)
      : undefined;

    const isCreating = props.ui.creatingEnvParent ?? false;

    useEffect(() => {
      if (createdEnvParent && !awaitingMinDelay) {
        history.push(
          orgRoute(`/${envParentType}s/${createdEnvParent.id}/environments`)
        );
      }
    }, [Boolean(createdEnvParent), awaitingMinDelay]);

    const onSubmit = async () => {
      setAwaitingMinDelay(true);
      wait(MIN_ACTION_DELAY_MS).then(() => setAwaitingMinDelay(false));

      props.setUiState({ creatingEnvParent: true });

      const type = {
        app: Api.ActionType.CREATE_APP,
        block: Api.ActionType.CREATE_BLOCK,
      }[envParentType] as
        | Api.ActionType.CREATE_APP
        | Api.ActionType.CREATE_BLOCK;
      const payload = { name, settings: { autoCaps: true } };

      const res = await dispatch({ type, payload });

      if (res.success) {
        const byType = g.graphTypes(res.state.graph);
        const scope = {
          apps: byType.apps,
          blocks: byType.blocks,
        }[(envParentType + "s") as "apps" | "blocks"] as Model.EnvParent[];

        const created = scope.find(
          ({ createdAt }) => createdAt === res.state.graphUpdatedAt
        );
        if (created) {
          if (willImport) {
            const environmentIds: string[] = [];
            const importPromises: Promise<any>[] = [];
            for (let environmentRoleId of importableEnvironmentRoleIds) {
              const parsed = parsedByEnvironmentRoleId[environmentRoleId];
              const environment = (
                g.getEnvironmentsByEnvParentId(res.state.graph)[created.id] ??
                []
              ).find(
                (e) => !e.isSub && e.environmentRoleId == environmentRoleId
              );

              if (parsed && environment) {
                environmentIds.push(environment.id);
                importPromises.push(
                  props.dispatch({
                    type: Client.ActionType.IMPORT_ENVIRONMENT,
                    payload: {
                      envParentId: created.id,
                      environmentId: environment.id,
                      parsed,
                    },
                  })
                );
              }
            }

            if (importPromises.length > 0) {
              props.setUiState({
                importingNewEnvParentId: created.id,
              });

              await Promise.all(importPromises);
              await props.dispatch({
                type: Client.ActionType.COMMIT_ENVS,
                payload: {
                  pendingEnvironmentIds: environmentIds,
                  message: "Initial import",
                },
              });
            }
          }

          setCreatedId(created.id);
        }
      }
    };

    const canSubmit =
      name.trim() &&
      (!willImport ||
        !R.any(
          (valid) => valid === false,
          Object.values(validByEnvironmentRoleId)
        ));

    return (
      <div className={styles.OrgContainer}>
        <div className="field">
          <label>{capitalize(envParentType)} Name</label>
          <input
            type="text"
            value={name}
            placeholder={`Enter ${capitalize(envParentType)} name...`}
            disabled={Boolean(isCreating || createdId)}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div className="field radio-group">
          <RadioGroup
            selectedValue={willImport ? "true" : "false"}
            onChange={(val) => setWillImport(val == "true")}
          >
            <label className={willImport ? "" : "selected"}>
              <Radio disabled={isCreating} value="false" />
              <span>Start from scratch</span>
            </label>
            <label className={willImport ? "selected" : ""}>
              <Radio disabled={isCreating} value="true" />
              <span>Import config</span>
            </label>
          </RadioGroup>
        </div>

        {willImport ? (
          <NewEnvParentImporter
            {...props}
            envParentType={envParentType}
            disabled={isCreating || undefined}
            environmentRoleIds={importableEnvironmentRoleIds}
            environmentRoleIdsSet={importableEnvironmentRoleIdsSet}
            validByEnvironmentRoleId={validByEnvironmentRoleId}
            valuesByEnvironmentRoleId={valuesByEnvironmentRoleId}
            parsedByEnvironmentRoleId={parsedByEnvironmentRoleId}
            onChange={(values, valid, parsed) => {
              setValuesByEnvironmentRoleId(values);
              setValidByEnvironmentRoleId(valid);
              setParsedByEnvironmentRoleId(parsed);
            }}
          />
        ) : (
          ""
        )}

        <div className="buttons">
          <button
            className="primary"
            disabled={!canSubmit || isCreating || Boolean(createdId)}
            onClick={onSubmit}
          >
            {isCreating
              ? `Creating ${capitalize(envParentType)}...`
              : `Create ${capitalize(envParentType)}`}
          </button>
        </div>
      </div>
    );
  };

  return NewEnvParent;
};

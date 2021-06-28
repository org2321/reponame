import React, { useState } from "react";
import { OrgComponent } from "@ui_types";
import { Model, Client } from "@core/types";
import { EnvImportForm } from "./env_import_form";
import * as g from "@core/lib/graph";
import { style } from "typestyle";
import * as styles from "@styles";

export const EnvImport: OrgComponent = (props) => {
  const { graph } = props.core;
  const searchParams = new URLSearchParams(props.location.search);
  const importEnvironmentId = searchParams.get("importEnvironmentId")!;

  const environment = graph[importEnvironmentId] as Model.Environment;
  const envParent = graph[environment.envParentId] as Model.EnvParent;
  const environmentName = g.getEnvironmentName(graph, environment.id);

  const close = () => {
    props.history.push(
      props.location.pathname.replace(
        `?importEnvironmentId=${importEnvironmentId}`,
        ""
      )
    );
  };

  const [val, setVal] = useState(""),
    [valid, setValid] = useState(false),
    [parsed, setParsed] = useState<Record<string, string>>();

  return (
    <div className={styles.EnvImporter}>
      <div
        className="overlay"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
      >
        <span className="back">
          <span>← Back</span>
        </span>
      </div>
      <div className="modal">
        <h3>
          Import <strong>{environmentName}</strong>
        </h3>

        <EnvImportForm
          {...props}
          envParentType={envParent.type}
          environmentName={environmentName}
          value={val}
          onChange={(value, valid, parsed) => {
            setVal(value);
            setValid(valid);
            setParsed(parsed);
          }}
        />

        <div className="buttons">
          <button
            className="primary"
            disabled={!valid || !parsed}
            onClick={() => {
              if (!valid || !parsed) {
                return;
              }

              props.dispatch({
                type: Client.ActionType.IMPORT_ENVIRONMENT,
                payload: {
                  envParentId: envParent.id,
                  environmentId: environment.id,
                  parsed,
                },
              });

              close();
            }}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
};

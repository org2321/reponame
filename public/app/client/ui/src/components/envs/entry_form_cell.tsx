import React, { useState, useRef, useEffect, useMemo } from "react";
import { EnvManagerComponent } from "@ui_types";
import { Client, Model } from "@core/types";
import { isMultiline } from "@core/lib/utils/string";
import * as g from "@core/lib/graph";
import { style } from "typestyle";
import * as ui from "@ui";
import { getValDisplay } from "@ui_lib/envs";

type Props = {
  undefinedPlaceholder?: React.ReactNode;
} & (
  | {
      type: "entry";
      environmentId?: undefined;
    }
  | {
      type: "entryVal";
      canUpdate?: boolean;
      environmentId: string;
    }
);

const entryPlaceholder = "VARIABLE_NAME";

export const EntryFormCell: EnvManagerComponent<{}, Props> = (props) => {
  const { graph, graphUpdatedAt } = props.core;
  const currentUserId = props.ui.loadedAccountId!;
  const org = g.getOrg(graph);
  const envParent = graph[props.envParentId] as Model.EnvParent;

  const autoCaps = useMemo(() => {
    if (props.type != "entry") {
      return false;
    }
    return envParent.settings.autoCaps ?? org.settings.envs.autoCaps;
  }, [graphUpdatedAt, currentUserId, props.type, props.envParentId]);

  let val: string | undefined,
    inheritsEnvironmentId: string | undefined,
    isEmpty: boolean | undefined,
    isUndefined: boolean | undefined;

  const entryFormState = props.ui.envManager.entryForm;

  if (props.type == "entry") {
    val = entryFormState.entryKey;
  } else if (props.type == "entryVal") {
    const cell: Client.Env.EnvWithMetaCell | undefined =
      entryFormState.vals[props.environmentId];

    if (cell) {
      ({ val, inheritsEnvironmentId, isEmpty, isUndefined } = cell);
    } else {
      isUndefined = true;
    }
  }

  const isEditing =
    (props.type == "entry" && entryFormState.editingEntryKey) ||
    (props.type == "entryVal" &&
      props.environmentId == entryFormState.editingEnvironmentId);

  const canUpdate =
    props.type == "entry" || (props.environmentId && props.canUpdate);

  const showInput = canUpdate && isEditing;
  const showAutocomplete = showInput && props.type == "entryVal" && !val;

  const currentUpdate = {
    val,
    inheritsEnvironmentId,
    isEmpty,
    isUndefined,
  } as Client.Env.EnvWithMetaCell;

  const clickedToEdit = entryFormState.clickedToEdit;

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const isMulti =
    props.type == "entryVal" && props.editingMultiline && showInput;

  const [lastCommitted, setLastCommitted] =
    useState<string | Client.Env.EnvWithMetaCell>();

  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();

      // ensure smooth toggling between single and multi-line mode while editing
      if (clickedToEdit) {
        inputRef.current.select();
        inputRef.current.scrollTop = 0;
        props.setEntryFormState({ clickedToEdit: undefined });
      } else if (val) {
        inputRef.current.setSelectionRange(val.length, val.length);
      }
    }
  }, [props.envParentId, showInput, props.editingMultiline]);

  useEffect(() => {
    if (
      props.type == "entry" &&
      props.ui.envManager.submittedEntryKey &&
      showInput &&
      inputRef.current
    ) {
      inputRef.current.focus();
    }
  }, [props.ui.envManager.submittedEntryKey]);

  const cancel = () => {
    if (props.type == "entry") {
      props.setEntryFormState({
        editingEntryKey: undefined,
        editingEnvironmentId: undefined,

        entryKey: lastCommitted as string,
      });
    } else if (props.type == "entryVal") {
      props.setEntryFormState({
        editingEntryKey: undefined,
        editingEnvironmentId: undefined,

        vals: {
          ...(entryFormState.vals ?? {}),
          [props.environmentId]: lastCommitted as Client.Env.EnvWithMetaCell,
        },
      });
    }
  };

  const commit = () => {
    if (props.type == "entry") {
      setLastCommitted(val ?? "");
    } else if (props.type == "entryVal") {
      setLastCommitted(currentUpdate);
    }
  };

  const clearEditing = () => {
    props.setEntryFormState({
      editingEntryKey: undefined,
      editingEnvironmentId: undefined,
    });
  };

  const setEntry = (inputVal: string) => {
    props.setEntryFormState({ entryKey: inputVal });
  };

  const setEntryVal = (update: Client.Env.EnvWithMetaCell) => {
    if (!props.environmentId) {
      return;
    }
    props.setEntryFormState({
      vals: { ...entryFormState.vals, [props.environmentId]: update },
    });
  };

  const submitEntryVal = (update: Client.Env.EnvWithMetaCell) => {
    if (!props.environmentId) {
      return;
    }

    props.setEntryFormState({
      vals: { ...entryFormState.vals, [props.environmentId]: update },
      editingEntryKey: undefined,
      editingEnvironmentId: undefined,
    });

    setLastCommitted(update);
  };

  let cellContents: React.ReactNode[] = [];
  let classNames: string[] = ["cell"];

  classNames.push(
    props.type == "entry" || (props.type == "entryVal" && props.canUpdate)
      ? "writable"
      : "not-writable"
  );

  if (showInput) {
    classNames.push("editing");

    const inputProps = {
      ref: inputRef as any,
      spellCheck: false,
      placeholder:
        props.type == "entry"
          ? entryPlaceholder
          : "Insert value or choose below.",
      value: val || "",
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
      ) => {
        let inputVal = e.currentTarget.value;
        if (autoCaps) {
          inputVal = inputVal.toUpperCase();
        }
        if (inputVal != val) {
          if (props.type == "entry") {
            setEntry(inputVal);
          } else if (props.type == "entryVal") {
            setEntryVal({
              val: inputVal,
              isUndefined: typeof inputVal == "undefined" ? true : undefined,
              isEmpty: inputVal === "" ? true : undefined,
            } as Client.Env.EnvWithMetaCell);
          }
        }
      },
      onClick: (e: React.MouseEvent) => {
        if (isEditing) {
          e.stopPropagation();
        }
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key == "Enter") {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey && props.type == "entryVal") {
            setEntryVal({ val: (val ?? "") + "\n" });
          } else if (!e.shiftKey) {
            commit();
            clearEditing();
          }
        } else if (e.key == "Escape") {
          cancel();
        }
      },
      onBlur: () => {
        if (!showAutocomplete) {
          commit();
        }
      },
      className: style({
        textAlign: props.type == "entry" ? "left" : "center",
        width: "100%",
        height: isMulti ? props.gridHeight : undefined,
      }),
    };

    cellContents.push(
      val && isMulti ? (
        <textarea {...inputProps} />
      ) : (
        <input type="text" {...inputProps} />
      )
    );

    if (showAutocomplete && props.environmentId) {
      cellContents.push(
        <ui.CellAutocomplete
          {...props}
          initialSelected={currentUpdate}
          onSelect={(update) => {
            submitEntryVal(update);
          }}
        />
      );
    }
  } else {
    let display: React.ReactNode;
    const valDisplay = getValDisplay(val ?? "");

    if (props.type == "entry") {
      display = val || (
        <small>{props.undefinedPlaceholder || entryPlaceholder}</small>
      );
    } else if (inheritsEnvironmentId) {
      display = (
        <span>
          <small>inherits</small>
          {g.getEnvironmentName(props.core.graph, inheritsEnvironmentId)}
        </span>
      );
    } else if (isUndefined) {
      const environment = props.core.graph[props.environmentId] as
        | Model.Environment
        | undefined;

      const envName = environment
        ? g
            .getEnvironmentName(props.core.graph, props.environmentId)
            .toLowerCase()
        : "local";

      display = <small>{`Set ${envName} value (optional)`}</small>;
    } else if (isEmpty) {
      display = <small>empty string</small>;
    } else {
      display = <span>{valDisplay}</span>;
    }

    cellContents.push(<span>{display}</span>);
  }

  return (
    <div
      id={[props.environmentId, entryFormState.entryKey]
        .filter(Boolean)
        .join("|")}
      className={
        classNames.join(" ") +
        " " +
        style({
          width:
            props.type == "entry" ? props.entryColWidth : props.valColWidth,
          height: isMulti ? props.gridHeight : props.envRowHeight,
        })
      }
      onClick={() => {
        if (!isEditing) {
          props.setEntryFormState({
            editingEntryKey: props.type == "entry" ? true : undefined,
            editingEnvironmentId:
              props.type == "entryVal" ? props.environmentId : undefined,
            clickedToEdit: true,
          });
        }
      }}
    >
      {cellContents}
    </div>
  );
};

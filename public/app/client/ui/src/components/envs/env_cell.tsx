import React, { useRef, useEffect, useMemo } from "react";
import { EnvManagerComponent, EnvManagerState } from "@ui_types";
import { Client, Model } from "@core/types";
import * as g from "@core/lib/graph";
import * as R from "ramda";
import { style } from "typestyle";
import { layout } from "@styles";
import * as ui from "@ui";
import { stripUndefinedRecursive } from "@core/lib/utils/object";
import { getValDisplay } from "@ui_lib/envs";
import { SvgImage } from "@images";
import * as EntryForm from "./entry_form";

type Props = {
  entryKey: string;
  canUpdate: boolean;
  undefinedPlaceholder?: React.ReactNode;
  isConnectedBlock?: true;
  connectedBlockEnvironmentIds?: string[];
  pending: boolean;
} & (
  | {
      type: "entry";
      environmentId?: undefined;
    }
  | {
      type: "entryVal";
      environmentId: string;
      cell: Client.Env.UserEnvCell | undefined;
      canRead: boolean;
      canReadMeta: boolean;
    }
);

const CLEARED_EDIT_STATE: Partial<EnvManagerState> = {
  editingEntryKey: undefined,
  editingEnvironmentId: undefined,
  editingInputVal: undefined,
  clickedToEdit: undefined,
};

const maskDots = <span>{"●●●●●●●●●●●"}</span>,
  entryPlaceholder = "VARIABLE_NAME";

export const EnvCell: EnvManagerComponent<{}, Props> = (props) => {
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
    isUndefined: boolean | undefined,
    hasMetaVal = false;

  if (props.type == "entry") {
    val = props.entryKey;
  } else if (props.type == "entryVal") {
    if (props.cell) {
      ({ val, inheritsEnvironmentId, isEmpty, isUndefined } = props.cell);
    } else {
      isUndefined = true;
    }

    hasMetaVal =
      !inheritsEnvironmentId &&
      !isEmpty &&
      !isUndefined &&
      typeof val == "undefined";
  }

  const isEditing =
    props.ui.envManager.editingEntryKey == props.entryKey &&
    ((props.type == "entry" && !props.ui.envManager.editingEnvironmentId) ||
      (props.type == "entryVal" &&
        props.environmentId == props.ui.envManager.editingEnvironmentId));

  const current =
    props.type == "entry"
      ? props.entryKey
      : (stripUndefinedRecursive({
          val,
          isUndefined,
          isEmpty,
          inheritsEnvironmentId,
        }) as Client.Env.EnvWithMetaCell);

  const inputVal = props.ui.envManager.editingInputVal;
  const clickedToEdit = props.ui.envManager.clickedToEdit;
  const cellId = [props.entryKey, props.environmentId]
    .filter(Boolean)
    .join("|");
  const committingToCore = props.ui.envManager.committingToCore;
  const committedVal = props.ui.envManager.committingToCore[cellId];
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const isCommitting = committedVal && !R.equals(current, committedVal);
  const showInput = props.canUpdate && !isCommitting && isEditing;
  const showAutocomplete = showInput && props.type == "entryVal" && !inputVal;
  const isMulti = props.editingMultiline && showInput;

  if (typeof committedVal == "string") {
    val = committedVal;
  } else if (committedVal) {
    ({ val, inheritsEnvironmentId, isEmpty, isUndefined } = committedVal);
  }

  useEffect(() => {
    if (committedVal && R.equals(current, committedVal)) {
      props.setEnvManagerState({
        committingToCore: R.omit([cellId], committingToCore),
      });
    }
  }, [committedVal, current]);

  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();

      // ensure smooth toggling between single and multi-line mode while editing
      if (clickedToEdit) {
        inputRef.current.select();
        inputRef.current.scrollTop = 0;
        props.setEnvManagerState({ clickedToEdit: undefined });
      } else if (inputVal) {
        inputRef.current.setSelectionRange(inputVal.length, inputVal.length);
      }
    }
  }, [props.envParentId, showInput, props.editingMultiline]);

  const submitEntry = () => {
    if (!inputVal || inputVal === props.entryKey) {
      return;
    }
    if (props.routeParams.subEnvironmentId) {
      props.dispatch({
        type: Client.ActionType.UPDATE_ENTRY,
        payload: {
          envParentId: props.envParentId,
          environmentId: props.routeParams.subEnvironmentId,
          entryKey: props.entryKey,
          newEntryKey: inputVal,
        },
      });
    } else {
      props.dispatch({
        type: Client.ActionType.UPDATE_ENTRY_ROW,
        payload: {
          envParentId: props.envParentId,
          entryKey: props.entryKey,
          newEntryKey: inputVal,
        },
      });
    }

    props.setEnvManagerState({
      ...CLEARED_EDIT_STATE,
      committingToCore: { ...committingToCore, [cellId]: inputVal },
    });
  };

  const submitEntryVal = (update: Client.Env.EnvWithMetaCell) => {
    if (!props.environmentId) {
      return;
    }

    props.dispatch({
      type: Client.ActionType.UPDATE_ENTRY_VAL,
      payload: {
        envParentId: props.envParentId,
        environmentId: props.environmentId,
        entryKey: props.entryKey,
        update,
      },
    });
    props.setEnvManagerState({
      ...CLEARED_EDIT_STATE,
      committingToCore: {
        ...committingToCore,
        [cellId]: stripUndefinedRecursive(update),
      },
    });
  };

  const commitInput = () => {
    if (inputVal != val && !showAutocomplete) {
      if (props.type == "entry" && inputVal) {
        submitEntry();
      } else if (props.type == "entryVal") {
        submitEntryVal({
          val: inputVal,
          isEmpty: inputVal === "" ? true : undefined,
          isUndefined: undefined,
        } as Client.Env.EnvWithMetaCell);
      }
    }
  };

  let cellContents: React.ReactNode[] = [];
  let classNames: string[] = ["cell"];

  classNames.push(props.canUpdate ? "writable" : "not-writable");

  if (props.type == "entryVal") {
    if (props.canRead) {
      classNames.push("readable");
    } else if (props.canReadMeta) {
      classNames.push("meta-readable");
    }
  }

  if (props.pending) {
    classNames.push("pending");
  }

  if (showInput) {
    classNames.push("editing");

    const inputProps = {
      ref: inputRef as any,
      spellCheck: false,
      placeholder:
        props.type == "entry"
          ? entryPlaceholder
          : "Start typing or choose below...",
      value: inputVal || "",
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
      ) => {
        let newVal = e.target.value;
        if (autoCaps) {
          newVal = newVal.toUpperCase();
        }
        props.setEnvManagerState({ editingInputVal: newVal });
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key == "Enter") {
          if (e.shiftKey && props.type == "entryVal") {
            props.setEnvManagerState({ editingInputVal: inputVal + "\n" });
          } else if (!e.shiftKey) {
            e.preventDefault();
            commitInput();
          }
        } else if (e.key == "Escape") {
          props.setEnvManagerState(CLEARED_EDIT_STATE);
        }
      },
      onBlur: () => {
        commitInput();
      },
      onClick: (e: React.MouseEvent) => {
        if (isEditing) {
          e.stopPropagation();
        }
      },
    };

    cellContents.push(
      inputVal && isMulti ? (
        <textarea {...inputProps} />
      ) : (
        <input {...inputProps} />
      )
    );

    if (showAutocomplete && props.environmentId) {
      classNames.push("autocomplete-open");
      cellContents.push(
        <ui.CellAutocomplete
          {...props}
          initialSelected={
            {
              val,
              inheritsEnvironmentId,
              isUndefined,
              isEmpty,
            } as Client.Env.EnvWithMetaCell
          }
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
      display = valDisplay ? (
        <span>{valDisplay}</span>
      ) : (
        <small>{props.undefinedPlaceholder || entryPlaceholder}</small>
      );
    } else if (inheritsEnvironmentId && graph[inheritsEnvironmentId]) {
      classNames.push("special");
      classNames.push("inherits");
      display = (
        <span>
          <small>inherits</small>
          <label>{g.getEnvironmentName(graph, inheritsEnvironmentId)}</label>
        </span>
      );
    } else if (
      (valDisplay && props.ui.envManager.hideValues) ||
      (!props.canUpdate && hasMetaVal)
    ) {
      classNames.push("masked");
      display = maskDots;
    } else if (valDisplay && !props.ui.envManager.hideValues) {
      display = <span>{valDisplay}</span>;
    } else if (
      isUndefined ||
      (inheritsEnvironmentId && !graph[inheritsEnvironmentId])
    ) {
      classNames.push("special");
      classNames.push("undefined");
      if (props.undefinedPlaceholder) {
        classNames.push("placeholder");
      }

      if (props.environmentId == "") {
        display = <SvgImage type="na" />;
      } else {
        display = <small>{props.undefinedPlaceholder || "undefined"}</small>;
      }
    } else if (isEmpty) {
      classNames.push("special");
      classNames.push("empty");
      display = <small>empty string</small>;
    } else {
      display = "";
    }

    cellContents.push(display);
  }

  if (!isEditing && !showAutocomplete && !isUndefined && props.canUpdate) {
    cellContents.push(
      <div
        onClick={(e) => {
          e.stopPropagation();

          if (props.type == "entry") {
            props.setEnvManagerState({
              ...CLEARED_EDIT_STATE,
              entryForm: EntryForm.CLEARED_EDIT_STATE,
              showAddForm: false,
              confirmingDeleteEntryKeyComposite: [
                props.envParentId,
                props.entryKey,
              ].join("|"),
            });
          } else {
            props.dispatch({
              type: Client.ActionType.UPDATE_ENTRY_VAL,
              payload: {
                envParentId: props.envParentId,
                environmentId: props.environmentId,
                entryKey: props.entryKey,
                update: {
                  isUndefined: true,
                },
              },
            });
          }
        }}
        className="remove"
      >
        <SvgImage type="x" />
      </div>
    );
  }

  return (
    <div
      id={cellId}
      className={
        classNames.join(" ") +
        " " +
        style({
          height: isMulti
            ? props.gridHeight -
              (props.isConnectedBlock ? layout.ENV_ROW_HEIGHT : 0)
            : props.envRowHeight,
        })
      }
      onClick={() => {
        if (!isEditing && props.canUpdate) {
          props.setEnvManagerState({
            editingEntryKey: props.entryKey,
            editingEnvironmentId:
              props.type == "entryVal" ? props.environmentId : undefined,
            editingInputVal: val,
            clickedToEdit: true,
            showAddForm: false,
            confirmingDeleteEntryKeyComposite: undefined,
            entryForm: EntryForm.CLEARED_EDIT_STATE,
          });
        }
      }}
    >
      {cellContents}
    </div>
  );
};

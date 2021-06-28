import React, { useState, useEffect, useMemo, useCallback } from "react";
import { EnvManagerComponent } from "@ui_types";
import { Client } from "@core/types";
import * as g from "@core/lib/graph";
import * as R from "ramda";
import { style } from "typestyle";
import { stripUndefinedRecursive } from "@core/lib/utils/object";
import * as styles from "@styles";
import { getPendingInheritingEnvironmentIds } from "@core/lib/client";

type Props = {
  environmentId: string;
  entryKey?: string;
  onSelect: (update: Client.Env.EnvWithMetaCell) => void;
  initialSelected: Client.Env.EnvWithMetaCell;
};

type Option = {
  label: React.ReactNode;
  update: Client.Env.EnvWithMetaCell;
};

export const CellAutocomplete: EnvManagerComponent<{}, Props> = (props) => {
  const options: Option[] = useMemo(
    () => [
      {
        label: "undefined",
        update: { isUndefined: true },
      },
      {
        label: "empty string",
        update: { isEmpty: true, val: "" },
      },
      ...g.authz
        .getInheritableEnvironments(
          props.core.graph,
          props.ui.loadedAccountId!,
          props.environmentId,
          getPendingInheritingEnvironmentIds(props.core, props)
        )
        .map((inheritableEnvironment) => ({
          label: (
            <span>
              inherits
              <strong>
                {g.getEnvironmentName(
                  props.core.graph,
                  inheritableEnvironment.id
                )}
              </strong>
            </span>
          ),
          update: { inheritsEnvironmentId: inheritableEnvironment.id },
        })),
    ],
    [
      props.core.graphUpdatedAt,
      props.ui.loadedAccountId!,
      props.environmentId,
      props.core.pendingEnvUpdates.length,
    ]
  );

  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const i = options.findIndex((option) => {
      return R.equals(
        option.update,
        stripUndefinedRecursive(props.initialSelected)
      );
    });

    setSelectedIndex(i == -1 ? 0 : i);
  }, [options, props.initialSelected]);

  const onKeydown = useCallback(
    (e: KeyboardEvent) => {
      const isCommit = e.key == "Enter" && !e.shiftKey && selectedIndex > -1;
      const isUp = e.key == "ArrowUp";
      const isDown = e.key == "ArrowDown";

      if (isCommit || isUp || isDown) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (isCommit) {
        props.onSelect(options[selectedIndex].update);
      } else if (isUp) {
        setSelectedIndex(Math.max(-1, selectedIndex - 1));
      } else if (isDown) {
        const i = Math.min(options.length - 1, selectedIndex + 1);
        setSelectedIndex(i);
      }
    },
    [options, selectedIndex]
  );

  useEffect(() => {
    document.documentElement.addEventListener("keydown", onKeydown);
    return () => {
      document.documentElement.removeEventListener("keydown", onKeydown);
    };
  }, [onKeydown]);

  const renderOption = (option: Option, i: number) => {
    return (
      <div
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          props.onSelect(option.update);
        }}
        onMouseOver={() => {
          setSelectedIndex(i);
        }}
        className={"option" + (i == selectedIndex ? " selected" : "")}
      >
        {option.label}
      </div>
    );
  };

  return (
    <div className={styles.CellAutocomplete}>{options.map(renderOption)}</div>
  );
};

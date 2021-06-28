import React, { useState, useMemo, useEffect } from "react";
import * as R from "ramda";
import { fuzzySearch } from "@ui_lib/search";
import { style } from "typestyle";
import * as styles from "@styles";

type SelectableItem = {
  id: string;
  searchText: string;
  label: React.ReactNode;
};

type Props = {
  items: SelectableItem[];
  onSubmit: (ids: string[]) => any;
  submitting?: boolean;
  emptyText: string;
  actionLabel?: string;
  title: string;
  winHeight: number;
};

export const MultiSelect: React.FC<Props> = (props) => {
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [filter, setFilter] = useState("");

  const selectedIds = useMemo(() => Object.keys(selected), [selected]);

  const filtered = useMemo(() => {
    if (!filter.trim()) {
      return props.items;
    }

    const selectedItems = props.items.filter(({ id }) => selected[id]);

    const { items } = fuzzySearch({
      items: props.items,
      textField: "searchText",
      filter,
    });

    return R.uniqBy(R.prop("id"), items.concat(selectedItems));
  }, [props.items, filter]);

  const submit = () => {
    const selectedIds = Object.keys(selected);
    if (selectedIds.length == 0) {
      return;
    }

    props.onSubmit(selectedIds);

    setSelected({});
  };

  const renderOption = (item: SelectableItem) => {
    const isSelected = selected[item.id] ?? false;

    return (
      <div
        className={"option" + (isSelected ? " selected" : "")}
        onClick={(e) => {
          e.preventDefault();
          if (props.submitting) {
            return;
          }
          setSelected(
            selected[item.id]
              ? R.omit([item.id], selected)
              : { ...selected, [item.id]: true }
          );
        }}
      >
        <input
          type="checkbox"
          checked={selected[item.id]}
          disabled={props.submitting}
        />
        <label>{item.label}</label>
      </div>
    );
  };

  const renderSubmit = () => {
    return (
      <div className="buttons">
        <input
          className="primary"
          type="submit"
          disabled={selectedIds.length == 0 || props.submitting}
          value={`${
            props.submitting
              ? `${props.actionLabel ?? "Add"}ing`
              : props.actionLabel ?? "Add"
          } ${selectedIds.length ? selectedIds.length + " " : ""}${
            props.title
          }${selectedIds.length > 1 ? "s" : ""}${
            props.submitting ? "..." : ""
          }`}
          onClick={submit}
        />
      </div>
    );
  };

  if (props.items.length == 0) {
    return (
      <div className={styles.MultiSelect}>
        <span>{props.emptyText}</span>
      </div>
    );
  }

  const maxHeight = props.winHeight - (styles.layout.MAIN_HEADER_HEIGHT + 350);

  return (
    <div className={styles.MultiSelect}>
      <div className="field filter">
        <input
          type="text"
          value={filter}
          disabled={props.submitting}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Type here to filter..."
        />
      </div>

      <div
        className={
          "options " +
          style({
            maxHeight:
              props.winHeight - (styles.layout.MAIN_HEADER_HEIGHT + 250),
          })
        }
      >
        {filtered.map(renderOption)}
      </div>
      {renderSubmit()}
    </div>
  );
};

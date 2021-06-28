import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  OrgComponent,
  UiTree,
  UiNode,
  NavFilter,
  SearchableTree,
} from "@ui_types";
import { flattenTree } from "@ui_lib/ui_tree";
import { Link } from "react-router-dom";
import * as R from "ramda";
import { fuzzySearch } from "@ui_lib/search";
import * as styles from "@styles";
import { SvgImage } from "@images";
import * as g from "@core/lib/graph";

type FlagsById = Record<string, true>;

type Props = {
  defaultExpandTopLevel?: true;
};

const ADD_MENU_CLASS_NAME = "add-menu";

const NAV_FILTER_SEARCH_LABELS: Record<NavFilter, string> = {
  all: "for anything",
  apps: "apps",
  blocks: "blocks",
  orgUsers: "people",
  cliUsers: "CLI keys",
};

let currentRow = 0;

export const SearchTree: OrgComponent<{}, Props> = (params) => {
  const { ui, uiTree, orgRoute, defaultExpandTopLevel, core, setUiState } =
    params;
  const currentUserId = ui.loadedAccountId!;
  const { graph, graphUpdatedAt } = core;

  const [rawFilter, setRawFilter] = useState("");
  const [expandedItems, setExpandedItems] = useState<FlagsById>({});
  const [userCollapsedItems, setUserCollapsedItems] = useState<FlagsById>({});
  const [addMenuExpanded, setAddMenuExpanded] = useState(false);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      const expandedMenu = (e.target as HTMLElement).closest(
        `.${ADD_MENU_CLASS_NAME}`
      );
      if (expandedMenu) {
        return;
      }
      setAddMenuExpanded(false);
    };

    document.documentElement.addEventListener("click", fn);
    return () => {
      document.documentElement.removeEventListener("click", fn);
    };
  }, []);

  const searchInputRef = useRef<HTMLInputElement>(null);

  let preFilteredTree = useMemo(
    () => uiTree.filter(getPreFilterFn(ui.selectedCategoryFilter, 0)),
    [uiTree, ui.selectedCategoryFilter]
  );

  const filter = rawFilter.trim().toLowerCase();

  const [flatTree, filteredTree] = useMemo(() => {
    const flat = flattenTree(preFilteredTree);
    const searchable = flat.filter(
      R.propOr(false, "searchable")
    ) as SearchableTree;

    let filtered = preFilteredTree;
    if (filter) {
      filtered = search(preFilteredTree, searchable, filter);
    }
    filtered = removeRedundantLabels(filtered);
    return [flat, filtered];
  }, [preFilteredTree, filter]);

  const {
    canFilterApps,
    canFilterBlocks,
    canFilterOrgUsers,
    canFilterCliUsers,
    canCreateApp,
    canCreateBlock,
    canInviteUser,
    canCreateCliUser,
    canManageDevices,
  } = useMemo(() => {
    const { apps, blocks } = g.graphTypes(graph);

    return {
      canFilterApps: apps.length > 0,
      canFilterBlocks: blocks.length > 0,
      canFilterOrgUsers: g.authz.hasOrgPermission(
        graph,
        currentUserId,
        "org_manage_users"
      ),
      canFilterCliUsers:
        g.authz.hasOrgPermission(
          graph,
          currentUserId,
          "org_manage_cli_users"
        ) && g.getActiveCliUsers(graph).length > 0,
      canCreateApp: g.authz.canCreateApp(graph, currentUserId),
      canCreateBlock: g.authz.canCreateBlock(graph, currentUserId),
      canInviteUser: g.authz.canInviteAny(graph, currentUserId),
      canCreateCliUser: g.authz.canCreateAnyCliUser(graph, currentUserId),
      canManageDevices: g.authz.canManageAnyDevicesOrGrants(
        graph,
        currentUserId,
        Date.now()
      ),
    };
  }, [graphUpdatedAt]);

  const canFilterAny = [
    canFilterApps,
    canFilterBlocks,
    canFilterOrgUsers,
    canFilterCliUsers,
  ].some(Boolean);

  const canCreateAny = [
    canCreateApp,
    canCreateBlock,
    canInviteUser,
    canCreateCliUser,
    canManageDevices,
  ].some(Boolean);

  const expandTopLevel = () => {
    if (defaultExpandTopLevel && !filter) {
      const expanded: FlagsById = { ...expandedItems };
      for (let node of filteredTree) {
        if (node.id && !userCollapsedItems[node.id]) {
          expanded[node.id] = true;
        }
      }
      setExpandedItems(expanded);
    }
  };

  const resetExpanded = () => {
    if (defaultExpandTopLevel && !filter) {
      const expanded: FlagsById = {};
      for (let node of filteredTree) {
        if (node.id && !userCollapsedItems[node.id]) {
          expanded[node.id] = true;
        }
      }
      setExpandedItems(expanded);
    } else if (!filter) {
      setExpandedItems({});
    }
  };

  // expand top level by default
  useEffect(expandTopLevel, [uiTree]);

  // when searching expand all
  useEffect(() => {
    if (filter) {
      const expanded: FlagsById = {};
      for (let { id } of flatTree) {
        expanded[id] = true;
      }
      setExpandedItems(expanded);
    } else {
      resetExpanded();
    }
  }, [filter]);

  const renderSearchFilters = () => {
    if (!canFilterAny) {
      return;
    }
    return (
      <div className={styles.SearchTreeCategories}>
        <select
          value={ui.selectedCategoryFilter}
          onChange={(e) =>
            setUiState({ selectedCategoryFilter: e.target.value as NavFilter })
          }
        >
          <option value="all">All</option>
          <option value="apps">Apps</option>
          {canFilterBlocks ? <option value="blocks">Blocks</option> : ""}
          {canFilterOrgUsers ? <option value="orgUsers">People</option> : ""}
          {canFilterCliUsers ? <option value="cliUsers">CLI Keys</option> : ""}
        </select>
        <SvgImage type="down-caret" />
      </div>
    );
  };

  const renderAdd = () => {
    if (!canCreateAny) {
      return;
    }

    return (
      <div
        className={
          ADD_MENU_CLASS_NAME +
          " " +
          styles.SearchTreeAdd +
          (addMenuExpanded ? " expanded" : "")
        }
      >
        <div onClick={() => setAddMenuExpanded(!addMenuExpanded)}>
          <label>Add</label>
          <SvgImage type="add" />
        </div>

        <ul onClick={() => setAddMenuExpanded(false)}>
          {canCreateApp ? (
            <li>
              <Link to={orgRoute("/new-app")}>
                <span>Create App</span>
                <SvgImage type="right-caret" />
              </Link>
            </li>
          ) : (
            ""
          )}
          {canCreateBlock ? (
            <li>
              <Link to={orgRoute("/new-block")}>
                <span>Create Block</span>
                <SvgImage type="right-caret" />
              </Link>
            </li>
          ) : (
            ""
          )}
          {canInviteUser ? (
            <li>
              <Link to={orgRoute("/invite-users")}>
                <span>Invite People</span>
                <SvgImage type="right-caret" />
              </Link>
            </li>
          ) : (
            ""
          )}
          {canCreateCliUser ? (
            <li>
              <Link to={orgRoute("/new-cli-key")}>
                <span>Create CLI Key</span>
                <SvgImage type="right-caret" />
              </Link>
            </li>
          ) : (
            ""
          )}
          {canManageDevices ? (
            <li>
              <Link to={orgRoute("/devices")}>
                <span>Authorize Device</span>
                <SvgImage type="right-caret" />
              </Link>
            </li>
          ) : (
            ""
          )}
        </ul>
      </div>
    );
  };

  const renderActions = () => {
    if (!(canFilterAny || canCreateAny)) {
      return;
    }
    return (
      <section className={styles.SearchTreeActions}>
        {[renderSearchFilters(), renderAdd()]}
      </section>
    );
  };

  const renderSearchTree = (tree: UiTree, nesting = 0): HTMLLIElement[] => {
    let results: UiTree = tree;
    if (nesting > 0) {
      // top-level of tree is already pre-filtered
      results = tree.filter(getPreFilterFn(ui.selectedCategoryFilter, nesting));
    } else {
      currentRow = -1;
    }

    return R.flatten(
      results.map((node) => {
        currentRow++;
        const expanded = Boolean(
          node.id && node.tree?.length && expandedItems[node.id]
        );
        const expandable = Boolean(!expanded && node.id && node.tree?.length);
        const pad =
          nesting > 0
            ? R.repeat(`<small class="spacer"></small>`, nesting).join("")
            : "";

        let svgType: "triangle" | "dash";
        let toggle: (() => void) | undefined;

        if (expanded) {
          svgType = "triangle";
          toggle = () => {
            setExpandedItems(R.omit([node.id], expandedItems));
            setUserCollapsedItems({ ...expandedItems, [node.id]: true });
          };
        } else if (expandable) {
          svgType = "triangle";
          toggle = () => {
            setUserCollapsedItems(R.omit([node.id], userCollapsedItems));
            setExpandedItems({ ...expandedItems, [node.id]: true });
          };
        } else {
          svgType = "dash";
        }

        const bullet = (
          <span className="bullet" onClick={toggle}>
            <SvgImage type={svgType} />
          </span>
        );

        const content = node.path ? (
          <label>
            <Link to={orgRoute(node.path)}>{node.label}</Link>
            <SvgImage type="right-caret" />
          </label>
        ) : (
          <label>{node.label}</label>
        );

        const classNames = [
          node.header ? "header-row" : "tree-row",
          expandable ? "expandable" : null,
          expanded ? "expanded" : null,
          false ? "selected" : null,
          currentRow % 2 == 0 ? "even" : "odd",
        ].filter(Boolean);

        return [
          <li
            key={node.id ?? node.label}
            onClick={() => (toggle && node.header ? toggle() : null)}
            className={classNames.join(" ")}
          >
            <span className="toggle" onClick={toggle}>
              <span dangerouslySetInnerHTML={{ __html: pad }} />
              {bullet}
            </span>
            {content}
          </li>,
          expanded ? renderSearchTree(node.tree!, nesting + 1) : [],
        ];
      })
    ) as HTMLLIElement[];
  };

  return (
    <div className={styles.SearchTreeContainer}>
      <section
        className={styles.SearchTreeSearch}
        onClick={() => searchInputRef.current?.focus()}
      >
        <SvgImage type="search" />
        <input
          type="text"
          value={rawFilter}
          onChange={(e) => setRawFilter(e.target.value)}
          ref={searchInputRef}
          placeholder={`Search ${
            NAV_FILTER_SEARCH_LABELS[ui.selectedCategoryFilter]
          }...`}
        />
      </section>
      {renderActions()}
      <section className={styles.SearchTree}>
        <ul>{renderSearchTree(filteredTree)}</ul>
      </section>
    </div>
  );
};

const getPreFilterFn =
  (navFilter: NavFilter | undefined, nesting: number) => (node: UiNode) => {
    if (!node.showInTree) {
      return false;
    }
    if (nesting > 0 || !navFilter || navFilter == "all") {
      return true;
    }
    return navFilter === node.id;
  };

const search = (
  uiTree: UiTree,
  searchableTree: SearchableTree,
  filter: string
): UiTree => {
  const { searchRes } = fuzzySearch({
    items: searchableTree,
    textField: "label",
    filter,
    additionalSortFns: [R.ascend((res) => res.item.parentIds.length)],
  });

  const refIndexById: Record<string, number | undefined> = {};
  for (let res of searchRes) {
    const current = refIndexById[res.item.id];
    if (typeof current == "undefined" || res.refIndex < current) {
      refIndexById[res.item.id] = res.refIndex;
    }

    for (let parentId of res.item.parentIds) {
      const current = refIndexById[parentId];
      if (typeof current == "undefined" || res.refIndex < current) {
        refIndexById[parentId] = res.refIndex;
      }
    }
  }

  const filterAndSort = (tree: UiTree): UiTree => {
    const filtered = tree.filter(
      (node) => typeof refIndexById[node.id] != "undefined"
    );

    return R.sortBy((node) => refIndexById[node.id]!, filtered).map((node) =>
      node.tree ? { ...node, tree: filterAndSort(node.tree) } : node
    );
  };

  return filterAndSort(uiTree);
};

const removeRedundantLabels = (uiTree: UiTree): UiTree => {
  return uiTree
    .map((node) => {
      // remove redundant labels
      let subTree = (node.tree ?? []).filter(R.propOr(false, "showInTree"));

      if (
        subTree.length == 1 &&
        subTree[0].tree &&
        (subTree[0].id.endsWith("variables") ||
          subTree[0].id.endsWith("environments") ||
          subTree[0].id.endsWith("sub-environments"))
      ) {
        return {
          ...node,
          path: subTree[0].path,
          tree: removeRedundantLabels(subTree[0].tree),
        };
      }

      return {
        ...node,
        tree: subTree.length > 0 ? removeRedundantLabels(subTree) : undefined,
      };
    })
    .filter(Boolean) as UiTree;
};

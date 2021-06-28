import React from "react";
import { RouteComponentProps } from "react-router-dom";
import { Client, Model } from "@core/types";
import { dispatchCore } from "@core/lib/core_proc";
import { layout } from "@styles";

export type NavFilter = "all" | "apps" | "blocks" | "orgUsers" | "cliUsers";

export type LocalUiState = {
  accountId: string | undefined;
  loadedAccountId: string | undefined;
  selectedCategoryFilter: NavFilter;
  selectedObjectId?: string;
  envManager: EnvManagerState;
  sidebarWidth: number;
  pendingFooterHeight: number;
  now: number;
  creatingEnvParent?: boolean;
  importingNewEnvParentId?: string;
  justDeletedObjectId?: string;
  justRegeneratedInviteForUserId?: string;
};

export type CoreDispatchFn = (
  action: Client.Action.DispatchAction<Client.Action.EnvkeyAction>
) => ReturnType<typeof dispatchCore>;

export type ComponentBaseProps = {
  core: Client.State;
  dispatch: CoreDispatchFn;
  ui: LocalUiState;
  setUiState: (state: Partial<LocalUiState>) => void;
  refreshCoreState: () => Promise<void>;
  winWidth: number;
  winHeight: number;
};

export type ComponentProps<
  RouteProps extends {} = {},
  MoreProps extends {} = {}
> = ComponentBaseProps &
  RouteComponentProps<RouteProps> & { routeParams: RouteProps } & MoreProps;

export type OrgComponentProps<
  RouteProps extends {} = {},
  MoreProps extends {} = {}
> = ComponentProps<RouteProps, MoreProps> & {
  orgRoute: (path: string) => string;
  uiTree: UiTree;
  baseRouterPath?: string;
  hasPendingEnvUpdates?: boolean;
};

export type Component<RouteProps extends {} = {}, MoreProps extends {} = {}> =
  React.FC<
    ComponentProps &
      RouteComponentProps<RouteProps> & { routeParams: RouteProps } & MoreProps
  >;

export type OrgComponent<
  RouteProps extends {} = {},
  MoreProps extends {} = {}
> = Component<RouteProps & { orgId: string }, MoreProps & OrgComponentProps>;

export type UiNode = {
  id: string;
  tree?: UiTree;
  path?: string;
  showInTree?: boolean;
  label?: string | React.ReactElement;
  searchable?: boolean;
  header?: boolean;
};

export type UiTree = UiNode[];

export type FlatNode = Omit<UiNode, "tree"> & {
  parentIds: string[];
};
export type FlatTree = FlatNode[];

export type SearchableNode = Omit<FlatNode, "label"> & { label: string };

export type SearchableTree = SearchableNode[];

export type RouterNode = {
  routerPath: string;
  component: OrgComponent<any, any>;
  redirect?: (props: OrgComponentProps<any, any>) => string | false;
  tree?: RouterTree;
};
export type RouterTree = RouterNode[];

export type EnvGridState = {
  editingEntryKey?: string;
  editingEnvironmentId?: string;
  editingInputVal?: string;
  clickedToEdit?: boolean;
  committingToCore: Record<
    string,
    string | Client.Env.EnvWithMetaCell | undefined
  >;
  confirmingDeleteEntryKeyComposite?: string;
};

export type EntryFormState = Omit<
  EnvGridState,
  "editingEntryKey" | "editingInputVal" | "committingToCore"
> & {
  entryKey?: string;
  vals: Record<string, Client.Env.EnvWithMetaCell>;
  editingEntryKey?: boolean;
};

export type EnvManagerState = EnvGridState & {
  hideValues?: boolean;
  showAddForm?: boolean;
  entryForm: EntryFormState;
  showConnectBlocks?: boolean;
  entryColPct: number;
  environmentStartIndex: number;
  submittedEntryKey?: string;
  filter?: string;
  showFilter: boolean;
  showBlocks: boolean;
  userSetShowBlocks?: true;
};

export type EnvsUiPermissions = Record<
  string,
  {
    canRead: boolean;
    canUpdate: boolean;
    canReadMeta: boolean;
  }
>;

export type EnvsJustUpdated = {
  updatedAt: number;
  updatedById: string;
  updatedEnvironmentIds: string[];
  compareEnvWithMetaByEnvironmentId: Record<string, Client.Env.EnvWithMeta>;
};

export type EnvManagerProps = {
  envParentType: Model.EnvParent["type"];
  envParentId: string;
  localsUserId?: string;
  allEnvironmentIds: string[];
  visibleEnvironmentIds: string[];
  isSub: boolean;
  parentEnvironmentId?: string;
  numValCols: number;
  valColWidth: number;
  entryColWidth: number;
  viewWidth: number;
  viewHeight: number;
  gridHeight: number;
  headerHeight: number;
  labelRowHeight: number;
  envRowHeight: number;
  editingMultiline: boolean;
  showLeftNav: boolean;
  showRightNav: boolean;
  connectedBlocks: Model.Block[];
  connectedBlockIds: string[];
  envsJustUpdated: EnvsJustUpdated | undefined;
  setEnvManagerState: (update: Partial<EnvManagerState>) => void;
  setEntryFormState: (update: Partial<EntryFormState>) => void;
};

export type EnvManagerRouteProps = ({ appId: string } | { blockId: string }) & {
  userId?: string;
  environmentId?: string;
  subRoute?: "sub-environments";
  subEnvironmentId?: string;
};

export type EnvManagerComponent<
  RouteProps extends {} = {},
  MoreProps extends {} = {}
> = OrgComponent<
  EnvManagerRouteProps & RouteProps,
  MoreProps & EnvManagerProps
>;

export type ReactSelectOption = {
  value: string;
  label: string;
};

export const emptyEnvManagerState: EnvManagerState = {
  hideValues: true,
  showAddForm: undefined,
  editingEntryKey: undefined,
  editingEnvironmentId: undefined,
  editingInputVal: undefined,
  clickedToEdit: undefined,
  confirmingDeleteEntryKeyComposite: undefined,
  showFilter: false,
  filter: undefined,
  committingToCore: {},
  entryForm: { vals: {} },
  environmentStartIndex: 0,
  showBlocks: false,
  userSetShowBlocks: undefined,
  entryColPct: layout.ENTRY_COL_PCT,
};

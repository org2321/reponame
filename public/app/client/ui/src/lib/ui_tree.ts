import * as R from "ramda";
import * as g from "@core/lib/graph";
import * as ui from "@ui";
import { Client, Model } from "@core/types";
import { UiTree, UiNode, OrgComponent, FlatTree, FlatNode } from "@ui_types";
import { getEnvParentPath, getUserPath } from "./paths";
import { getEnvironmentName } from "@core/lib/graph";
import { getCurrentUserEnv } from "@core/lib/client";

// configuration of signed in org routes and searchable tree menu

type MaybeNode = UiNode | undefined;
type MaybeTree = MaybeNode[];
type TreeFn = (
  state: Client.State,
  currentUserId: string,
  now: number
) => UiTree;
type MaybeNodeFn = (
  state: Client.State,
  currentUserId: string,
  now: number
) => MaybeNode;
type NodeFn<T = UiNode> = (
  state: Client.State,
  currentUserId: string,
  now: number
) => T;
type NodeMapFn<T> = NodeFn<(obj: T) => UiNode>;

export const getUiTree: TreeFn = (state, currentUserId, now) => {
  const tree: MaybeTree = [
    appsNode(state, currentUserId, now),
    blocksNode(state, currentUserId, now),
    usersNode(state, currentUserId, now),
    cliUsersNode(state, currentUserId, now),
  ];

  return tree.filter(Boolean) as UiTree;
};

const newAppNode: MaybeNodeFn = (state, currentUserId, now) => {
  if (g.authz.canCreateApp(state.graph, currentUserId)) {
    return {
      id: "new-app",
    };
  }
  return undefined;
};

const newBlockNode: MaybeNodeFn = (state, currentUserId, now) => {
  if (g.authz.canCreateBlock(state.graph, currentUserId)) {
    return {
      id: "new-block",
    };
  }
  return undefined;
};

const newCliUserNodes = (
  state: Client.State,
  currentUserId: string,
  app?: Model.App
) => {
  let permitted: boolean;
  if (app) {
    permitted = g.authz.canCreateCliUserForApp(
      state.graph,
      currentUserId,
      app.id
    );
  } else {
    permitted = g.authz.canCreateAnyCliUser(state.graph, currentUserId);
  }

  if (!permitted) {
    return [];
  }

  return [
    {
      id: [app?.id, "new-cli-key"].filter(Boolean).join("|"),
    },
    {
      id: [app?.id, "generated-cli-key"].filter(Boolean).join("|"),
    },
  ];
};

const inviteUserNodes = (
  state: Client.State,
  currentUserId: string,
  invitableParent?: Model.App | Model.Group
) => {
  let permitted: boolean;
  if (invitableParent && invitableParent.type == "app") {
    permitted = g.authz.canInviteToApp(
      state.graph,
      currentUserId,
      invitableParent.id
    );
  } else if (
    invitableParent &&
    invitableParent.type == "group" &&
    invitableParent.objectType == "orgUser"
  ) {
    permitted =
      g.authz.canInviteAny(state.graph, currentUserId) &&
      g.authz.canManageUserGroups(state.graph, currentUserId);
  } else {
    permitted = g.authz.canInviteAny(state.graph, currentUserId);
  }

  if (!permitted) {
    return [];
  }

  return [
    {
      id: [invitableParent?.id, "invite-user-form"].filter(Boolean).join("|"),
    },
    {
      id: [invitableParent?.id, "generated-invites"].filter(Boolean).join("|"),
    },
    {
      id: [invitableParent?.id, "invite-users"].filter(Boolean).join("|"),
    },
  ];
};

const baseDevicesNode: MaybeNodeFn = (state, currentUserId, now) => {
  if (g.authz.canManageAnyDevicesOrGrants(state.graph, currentUserId, now)) {
    return {
      id: "devices",
    };
  }
  return undefined;
};

const myOrgNode: MaybeNodeFn = (state, currentUserId, now) => {
  const org = g.getOrg(state.graph);

  const tree = [
    {
      id: "my-org-environment-role-form",
    },

    g.authz.canUpdateOrgSettings(state.graph, currentUserId)
      ? (settingsNode(state, currentUserId, org) as UiNode)
      : null,

    g.authz.hasOrgPermission(
      state.graph,
      currentUserId,
      "org_manage_auth_settings"
    )
      ? {
          id: "my-org-sso",
        }
      : null,

    g.authz.hasOrgPermission(state.graph, currentUserId, "org_manage_billing")
      ? {
          id: "my-org-billing",
        }
      : null,

    g.authz.hasAnyOrgPermissions(state.graph, currentUserId, [
      "org_read_logs",
      "host_read_logs",
    ])
      ? {
          id: "my-org-logs",
        }
      : null,

    g.authz.hasOrgPermission(
      state.graph,
      currentUserId,
      "org_generate_recovery_key"
    )
      ? {
          id: "my-org-recovery-key",
        }
      : null,
  ].filter(Boolean) as UiTree;

  if (tree.length > 0) {
    return {
      id: "my-org",
      path: "/my-org",
      tree,
    };
  }
  return undefined;
};

const appsNode: NodeFn = (state, currentUserId, now) => {
  const { apps } = g.graphTypes(state.graph);
  return {
    label: "Apps",
    showInTree: true,
    id: "apps",
    header: true,
    tree: apps.map(envParentNodeFn(state, currentUserId, now)),
  };
};

const blocksNode: MaybeNodeFn = (state, currentUserId, now) => {
  const { blocks } = g.graphTypes(state.graph);
  if (
    blocks.length > 0 ||
    g.authz.hasOrgPermission(state.graph, currentUserId, "blocks_read_all")
  ) {
    return {
      label: "Blocks",
      showInTree: true,
      id: "blocks",
      header: true,
      tree: blocks.map(envParentNodeFn(state, currentUserId, now)),
    };
  }
  return undefined;
};

type UserStatus = "active" | "pending" | "expired" | "failed";
const usersNode: MaybeNodeFn = (state, currentUserId, now) => {
  const users = g.authz.getListableOrgUsers(state.graph, currentUserId);

  if (users.length > 0) {
    return {
      label: "People",
      showInTree: true,
      id: "orgUsers",
      header: true,
      tree: orgUsersByStatusTree(
        state,
        currentUserId,
        users,
        userNodeFn,
        "users",
        now
      ),
    };
  }
  return undefined;
};

const cliUsersNode: MaybeNodeFn = (state, currentUserId, now) => {
  const cliUsers = g.authz.getListableCliUsers(state.graph, currentUserId);

  if (cliUsers.length > 0) {
    return {
      label: "CLI Keys",
      showInTree: true,
      id: "cliUsers",
      header: true,
      tree: cliUsers.map(userNodeFn(state, currentUserId, now)),
    };
  }
  return undefined;
};

const envParentNodeFn =
  (state: Client.State, currentUserId: string, now: number) =>
  (envParent: Model.EnvParent): UiNode => {
    const path = getEnvParentPath(envParent);

    // const envParentTree: MaybeTree = [
    //   connectedAppsOrBlocksNode(state, currentUserId, envParent, path),
    //   environmentsNode(state, currentUserId, envParent, path),
    //   envParent.type == "app"
    //     ? envkeysNode(state, currentUserId, envParent, path, now)
    //     : undefined,
    //   collaboratorsNode(state, "orgUser", currentUserId, envParent, path, now),
    //   collaboratorsNode(state, "cliUser", currentUserId, envParent, path, now),
    //   {
    //     id: [envParent.id, "environment-role-form"].join("|"),
    //   },
    //   settingsNode(state, currentUserId, envParent),
    //   {
    //     id: [envParent.id, "versions"].join("|"),
    //   },
    //   {
    //     id: [envParent.id, "logs"].join("|"),
    //   },
    //   envParent.type == "block"
    //     ? {
    //         id: [envParent.id, "add-apps"].join("|"),
    //       }
    //     : undefined,
    // ];

    return {
      label: envParent.name,
      id: envParent.id,
      path,
      showInTree: true,
      searchable: true,
      // tree: envParentTree.filter(Boolean) as UiTree,
    };
  };

const connectedAppsOrBlocksNode = (
  state: Client.State,
  currentUserId: string,
  envParent: Model.EnvParent,
  basePath: string
): MaybeNode => {
  if (envParent.type == "app") {
    const connectedBlocks = g.getConnectedBlocksForApp(
      state.graph,
      envParent.id
    );

    const path = basePath + "/blocks";
    return {
      label: "Connected Blocks",
      id: [envParent.id, "connected-blocks"].join("|"),
      showInTree: connectedBlocks.length > 0,
      path,
      tree: connectedBlocks.map((block) => {
        const path = basePath + `/blocks/${block.id}`;

        return {
          label: block.name,
          id: [envParent.id, block.id].join("|"),
          // showInTree: true,
          // searchable: true,
          path,
        };
      }),
    };
  } else if (envParent.type == "block") {
    const connectedApps = g.getConnectedAppsForBlock(state.graph, envParent.id);
    const path = basePath + "/apps";
    return {
      label: "Connected Apps",
      id: [envParent.id, "connected-apps"].join("|"),
      showInTree: connectedApps.length > 0,
      path,
      tree: connectedApps.map((app) => ({
        label: app.name,
        id: [envParent.id, app.id].join("|"),
        // showInTree: true,
        // searchable: true,
        path: `${path}/${app.id}`,
      })),
    };
  }
  return undefined;
};

const environmentsNode = (
  state: Client.State,
  currentUserId: string,
  envParent: Model.EnvParent,
  basePath: string
): MaybeNode => {
  const visibleBaseEnvironments = g.authz.getVisibleBaseEnvironments(
    state.graph,
    currentUserId,
    envParent.id
  );
  return {
    label: "Environments",
    id: [envParent.id, "environments"].join("|"),
    path: basePath + "/environments",
    showInTree: visibleBaseEnvironments.length > 0,
    tree: visibleBaseEnvironments.map((environment) => {
      const path = basePath + `/environments/${environment.id}`;

      let tree = [
        // variablesNode(state, currentUserId, envParent, environment.id, path),
        subEnvironmentsNode(
          state,
          currentUserId,
          envParent,
          environment.id,
          path
        ),
        // localKeysNode(
        //   state,
        //   currentUserId,
        //   envParent,
        //   environment.id,
        //   basePath
        // ),
        // serversNode(state, currentUserId, envParent, environment.id, basePath),
      ].filter(Boolean) as UiTree;

      return {
        label: g.getEnvironmentName(state.graph, environment.id),
        id: environment.id,
        path,
        // showInTree: true,
        // searchable: true,
        tree: tree.length > 0 ? tree : undefined,
      };
    }),
  };
};

const localsTree = (
  state: Client.State,
  currentUserId: string,
  envParent: Model.EnvParent,
  userId: string,
  path: string
): UiTree | undefined => {
  if (
    !g.authz.canReadLocals(state.graph, currentUserId, envParent.id, userId)
  ) {
    return undefined;
  }

  const locals = getCurrentUserEnv(
    state,
    currentUserId,
    [envParent.id, userId].join("|"),
    true
  );

  if (!locals || !locals.variables) {
    return undefined;
  }

  const keys = entryKeysTree(
    [envParent.id, userId, "locals"].join("|"),
    locals,
    path
  );
  return keys.length > 0 ? keys : undefined;
};

const collaboratorsNode = (
  state: Client.State,
  userType: "orgUser" | "cliUser",
  currentUserId: string,
  envParent: Model.EnvParent,
  basePath: string,
  now: number
): UiNode => {
  const collaborators = {
    app: g.authz.getAppCollaborators,
    block: g.authz.getBlockCollaborators,
  }[envParent.type](state.graph, currentUserId, envParent.id, userType);

  const path = `${basePath}/${
    {
      orgUser: "collaborators",
      cliUser: "cli-keys",
    }[userType]
  }`;

  let tree: UiTree;

  if (userType == "orgUser") {
    tree = orgUsersByStatusTree(
      state,
      currentUserId,
      collaborators as Model.OrgUser[],
      (state, currentUserId, now) =>
        collaboratorsNodeFn(state, currentUserId, envParent, path, now),
      [envParent.id, "collaborators"].join("|"),
      now
    );
  } else {
    tree = collaborators.map(
      collaboratorsNodeFn(state, currentUserId, envParent, path, now)
    );
  }

  const component = {
    orgUser: {
      app: ui.AppCollaboratorsContainer,
      block: ui.BlockOrgUsers,
    },
    cliUser: {
      app: ui.AppCliUsersContainer,
      block: ui.BlockCliUsers,
    },
  }[userType][envParent.type];

  // sub-routes for app collaborators
  if (
    envParent.type == "app" &&
    userType == "orgUser" &&
    g.authz.canGrantAppAccess(
      state.graph,
      currentUserId,
      envParent.id,
      "orgUser"
    )
  ) {
    tree.push(
      {
        id: [envParent.id, "orgUsers", "add"].join("|"),
        tree: [
          {
            id: [envParent.id, "orgUsers", "add", "existing"].join("|"),
          },
          ...inviteUserNodes(state, currentUserId, envParent),
        ],
      },
      {
        id: [envParent.id, "orgUsers", "users"].join("|"),
      },
      {
        id: [envParent.id, "orgUsers", "teams"].join("|"),
        tree: [
          {
            id: [envParent.id, "orgUsers", "teams", "add"].join("|"),
          },
        ],
      }
    );
  }

  // sub-routes for app cli keys
  if (
    envParent.type == "app" &&
    userType == "cliUser" &&
    g.authz.canGrantAppAccess(
      state.graph,
      currentUserId,
      envParent.id,
      "cliUser"
    )
  ) {
    tree.push(
      {
        id: [envParent.id, "cliUsers", "add"].join("|"),
        tree: [
          {
            id: [envParent.id, "cliUsers", "add", "existing"].join("|"),
          },
          ...newCliUserNodes(state, currentUserId, envParent),
        ],
      },
      {
        id: [envParent.id, "cliUsers", "list"].join("|"),
      }
    );
  }

  return {
    label: userType == "orgUser" ? "Collaborators" : "CLI Keys",
    id: [envParent.id, userType].join("|"),
    path,
    // showInTree: tree.length > 0,
    // tree,
  };
};

const envkeysNode = (
  state: Client.State,
  currentUserId: string,
  envParent: Model.EnvParent,
  basePath: string,
  now: number
): MaybeNode => {
  if (
    envParent.type == "app" &&
    !g.authz.hasAnyAppPermissions(state.graph, currentUserId, envParent.id, [
      "app_manage_servers",
      "app_manage_local_keys",
    ])
  ) {
    return undefined;
  }

  if (envParent.type == "block") {
    const blockPermissions = g.getConnectedAppPermissionsUnionForBlock(
      state.graph,
      envParent.id,
      currentUserId
    );

    if (
      !(
        blockPermissions.has("app_manage_local_keys") ||
        blockPermissions.has("app_manage_servers")
      )
    ) {
      return undefined;
    }
  }

  return {
    id: [envParent.id, "envkeys"].join("|"),
  };
};

const subEnvironmentsNode = (
  state: Client.State,
  currentUserId: string,
  envParent: Model.EnvParent,
  environmentId: string,
  basePath: string
): UiNode => {
  const subEnvironments = (
    g.getSubEnvironmentsByParentEnvironmentId(state.graph)[environmentId] ?? []
  ).filter(
    ({ id }) =>
      g.authz.canReadEnv(state.graph, currentUserId, id) ||
      g.authz.canReadEnvMeta(state.graph, currentUserId, id)
  );

  const subEnvironmentsPath = `${basePath}/sub-environments`;

  const tree: UiTree = subEnvironments.map((subEnvironment) => {
    const path = `${subEnvironmentsPath}/${subEnvironment.id}`;

    let subEnvironmentTree = [
      // variablesNode(state, currentUserId, envParent, subEnvironment.id, path),
      // serversNode(state, currentUserId, envParent, subEnvironment.id, basePath),
    ].filter(Boolean) as UiTree;

    return {
      label: getEnvironmentName(state.graph, subEnvironment.id),
      id: subEnvironment.id,
      // showInTree: true,
      // searchable: true,
      path,
      tree: subEnvironmentTree.length > 0 ? subEnvironmentTree : undefined,
    };
  });

  const showInTree = subEnvironments.length > 0 || undefined;

  return {
    label: "Sub-environments",
    id: [environmentId, "sub-environments"].join(""),
    path: subEnvironmentsPath,
    // showInTree,
    tree,
  };
};

const variablesNode = (
  state: Client.State,
  currentUserId: string,
  envParent: Model.EnvParent,
  environmentId: string,
  basePath: string
): MaybeNode => {
  const userEnv = getCurrentUserEnv(state, currentUserId, environmentId, true);

  if (!userEnv || !userEnv.variables) {
    return undefined;
  }

  const nodeId = [environmentId, "variables"].join("|");
  const path = `${basePath}/variables`;
  const tree = entryKeysTree(nodeId, userEnv, path);

  if (tree.length > 0) {
    return {
      label: "Variables",
      id: nodeId,
      // showInTree: true,
      path,
      tree,
    };
  }

  return undefined;
};

const localKeysNode = (
  state: Client.State,
  currentUserId: string,
  envParent: Model.EnvParent,
  environmentId: string,
  basePath: string
): MaybeNode => {
  if (
    !g.authz.hasAppPermission(
      state.graph,
      currentUserId,
      envParent.id,
      "app_manage_local_keys"
    )
  ) {
    return undefined;
  }

  const localKeys =
    g.getLocalKeysByEnvironmentComposite(state.graph)[
      [environmentId, currentUserId].join("|")
    ] ?? [];

  if (localKeys.length > 0) {
    return {
      label: "Local Keys",
      id: [environmentId, "local-keys"].join("|"),
      // showInTree: true,
      path: `${basePath}/local-keys/${environmentId}`,
      tree: localKeys.map((localKey) => ({
        label: localKey.name,
        id: localKey.id,
        // showInTree: true,
        // searchable: true,
        path: `${basePath}/envkeys/localKey/${environmentId}/${localKey.id}`,
      })),
    };
  }
};

const serversNode = (
  state: Client.State,
  currentUserId: string,
  envParent: Model.EnvParent,
  environmentId: string,
  basePath: string
): MaybeNode => {
  if (
    !g.authz.hasAppPermission(
      state.graph,
      currentUserId,
      envParent.id,
      "app_manage_servers"
    )
  ) {
    return undefined;
  }

  const servers = g.getServersByEnvironmentId(state.graph)[environmentId] ?? [];

  if (servers.length > 0) {
    return {
      label: "Servers",
      id: [environmentId, "servers"].join("|"),
      // showInTree: true,
      path: `${basePath}/servers/${environmentId}`,
      tree: servers.map((server) => ({
        label: server.name,
        id: server.id,
        // showInTree: true,
        // searchable: true,
        path: `${basePath}/envkeys/server/${environmentId}/${server.id}`,
      })),
    };
  }
};

const entryKeysTree = (
  baseNodeId: string,
  env: Client.Env.EnvWithMeta | Client.Env.EnvMetaOnly,
  basePath: string
): UiTree => {
  const keys = Object.keys(env.variables);

  return keys.map((k) => ({
    label: k,
    id: [baseNodeId, k].join("|"),
    path: `${basePath}/${k}`,
    // showInTree: true,
    // searchable: true,
  }));
};

const orgUsersByStatusTree = (
  state: Client.State,
  currentUserId: string,
  orgUsers: Model.OrgUser[],
  nodeMapFn: NodeMapFn<Model.OrgUser>,
  idPrefix: string,
  now: number
) => {
  const byStatus = R.groupBy(({ id }) => {
    const status = g.getInviteStatus(state.graph, id, now);
    if (status == "accepted" || status == "creator") {
      return <const>"active";
    } else {
      return status;
    }
  }, orgUsers) as Record<UserStatus, Model.OrgUser[] | undefined>;

  const [active, pending, expired, failed] = R.props(
    ["active", "pending", "expired", "failed"],
    byStatus
  ).map((a) => a ?? []);

  return [
    ...active.map(nodeMapFn(state, currentUserId, now)),

    pending.length > 0
      ? {
          id: [idPrefix, "pending"].join("|"),
          label: "Invite Pending",
          showInTree: true,
          tree: pending.map(nodeMapFn(state, currentUserId, now)),
        }
      : undefined,

    expired.length > 0
      ? {
          id: [idPrefix, "expired"].join("|"),
          label: "Invite Expired",
          showInTree: true,
          tree: expired.map(nodeMapFn(state, currentUserId, now)),
        }
      : undefined,

    failed.length > 0
      ? {
          id: [idPrefix, "failed"].join("|"),
          label: "Invite Failed",
          showInTree: true,
          tree: failed.map(nodeMapFn(state, currentUserId, now)),
        }
      : undefined,
  ].filter(Boolean) as UiTree;
};

const collaboratorsNodeFn =
  (
    state: Client.State,
    currentUserId: string,
    envParent: Model.EnvParent,
    basePath: string,
    now: number
  ) =>
  (user: Model.OrgUser | Model.CliUser): UiNode => {
    const path = `${basePath}/${user.id}/locals`;

    const locals = localsTree(state, currentUserId, envParent, user.id, path);

    return {
      label: g.getUserName(state.graph, user.id),
      id: [envParent.id, user.id].join("|"),
      // showInTree: true,
      // searchable: true,
      path,
      tree: locals,
    };
  };

const userNodeFn =
  (state: Client.State, currentUserId: string, now: number) =>
  (user: Model.OrgUser | Model.CliUser): UiNode => {
    // const maybeUserTree: MaybeTree = [];
    // const { apps, blocks } = g.graphTypes(state.graph);
    // const permittedApps = apps.filter(({ id: appId }) =>
    //   Boolean(g.getAppRoleForUserOrInvitee(state.graph, appId, user.id))
    // );
    // // const permittedBlocks = blocks.filter(
    // //   ({ id: blockId }) =>
    // //     g.authz.hasOrgPermission(state.graph, user.id, "blocks_read_all") ||
    // //     g.getEnvParentPermissions(state.graph, blockId, user.id).size > 0
    // // );

    // maybeUserTree.push(
    //   {
    //     label: "Apps",
    //     id: [user.id, "apps"].join("|"),
    //     // showInTree: true,
    //     path: `${path}/apps`,
    //     // tree: permittedApps.map((app) => ({
    //     //   label: app.name,
    //     //   id: [user.id, app.id].join("|"),
    //     //   path: `${path}/apps/${app.id}`,
    //     //   showInTree: permittedApps.length > 0,
    //     //   searchable: true,
    //     // })),
    //   },
    //   {
    //     id: [user.id, "add-apps"].join("|"),
    //   }
    // );

    // maybeUserTree.push({
    //   label: "Blocks",
    //   id: [user.id, "blocks"].join("|"),
    //   // showInTree: true,
    //   path: `${path}/blocks`,
    //   // tree: permittedBlocks.map((block) => ({
    //   //   label: block.name,
    //   //   id: [user.id, block.id].join("|"),
    //   //   path: `${path}/blocks/${block.id}`,
    //   //   showInTree: permittedBlocks.length > 0,
    //   //   searchable: true,
    //   // })),
    // });

    // if (
    //   g.authz.canManageAnyUserDevicesOrGrants(
    //     state.graph,
    //     currentUserId,
    //     user.id,
    //     now
    //   )
    // ) {
    //   // const userDevices =
    //   //   g.getActiveOrgUserDevicesByUserId(state.graph)[user.id] ?? [];

    //   maybeUserTree.push({
    //     label: "Devices",
    //     id: [user.id, "devices"].join("|"),
    //     // showInTree: userDevices.length > 0,
    //     path: `${path}/devices`,
    //     // tree: userDevices.map((device) => ({
    //     //   label: device.name,
    //     //   id: [user.id, device.id].join("|"),
    //     //   // showInTree:
    //     //   //   userDevices.length > 0 ||
    //     //   //   g.authz.canCreateDeviceGrant(state.graph, currentUserId, user.id),
    //     //   // searchable: true,
    //     // })),
    //   });
    // }

    // maybeUserTree.push(settingsNode(state, currentUserId, user), {
    //   id: [user.id, "logs"].join("|"),
    // });

    // const userTree = maybeUserTree.filter(Boolean) as UiTree;

    const path = getUserPath(user);

    return {
      label: g.getUserName(state.graph, user.id),
      id: user.id,
      path,
      showInTree: true,
      searchable: true,
      // tree: userTree.length > 0 ? userTree : undefined,
    };
  };

const settingsNode = (
  state: Client.State,
  currentUserId: string,
  parent: Model.App | Model.Block | Model.OrgUser | Model.CliUser | Model.Org
): MaybeNode => {
  const id = [parent.id, "settings"].join("|");

  let permitted = false;
  let component:
    | OrgComponent<{ appId: string } | { blockId: string }>
    | OrgComponent<{ userId: string }>
    | OrgComponent;

  switch (parent.type) {
    case "app":
      permitted = g.authz.canUpdateAppSettings(
        state.graph,
        currentUserId,
        parent.id
      );
      component = ui.AppSettings;
      break;

    case "block":
      permitted = g.authz.canUpdateBlockSettings(
        state.graph,
        currentUserId,
        parent.id
      );
      component = ui.BlockSettings;
      break;

    case "orgUser":
      permitted = g.authz.canManageOrgUser(
        state.graph,
        currentUserId,
        parent.id
      );

      component = ui.OrgUserSettings;
      break;

    case "cliUser":
      permitted = g.authz.canManageCliUser(
        state.graph,
        currentUserId,
        parent.id
      );
      component = ui.CliUserSettings;

      break;

    case "org":
      permitted = g.authz.canUpdateOrgSettings(state.graph, currentUserId);
      component = ui.OrgSettings;
      break;
  }

  if (!permitted) {
    return undefined;
  }

  return {
    label: "Settings",
    id,
    // showInTree: true,
    path: "/settings",
  };
};

export const flattenTree = (
  tree: UiTree,
  parentIds: string[] = []
): FlatTree => {
  let flattened: FlatTree = [];

  for (let node of tree) {
    const subTree = node.tree;
    const flatNode: FlatNode = {
      ...R.omit(["tree"], node),
      parentIds,
    };
    flattened.push(flatNode);
    if (subTree) {
      flattened = flattened.concat(
        flattenTree(subTree, [...parentIds, ...(node.id ? [node.id] : [])])
      );
    }
  }

  return flattened;
};

export const findNode = (tree: UiTree, id: string): MaybeNode => {
  for (let node of tree) {
    if (node.id == id) {
      return node;
    }
    if (node.tree) {
      const res = findNode(node.tree, id);
      if (res) {
        return res;
      }
    }
  }
};

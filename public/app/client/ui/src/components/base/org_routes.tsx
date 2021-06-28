import React from "react";
import {
  OrgComponent,
  OrgComponentProps,
  RouterTree,
  RouterNode,
} from "@ui_types";
import { Route, Switch, Redirect, RouteComponentProps } from "react-router-dom";
import * as R from "ramda";
import * as ui from "@ui";
import { Model } from "@core/types";

const getRouterTree = (): RouterTree => [
  {
    routerPath: "/new-app",
    component: ui.NewApp,
  },
  {
    routerPath: "/new-block",
    component: ui.NewBlock,
  },

  // Org-level invites
  ...inviteRoutes,

  // Org-level cli keys
  ...cliKeyRoutes,

  // Apps
  {
    routerPath: "/apps/:appId",
    component: ui.AppContainer,
    redirect: envParentRedirectFn,
    tree: getEnvParentTree("app"),
  },

  // Blocks
  {
    routerPath: "/blocks/:blockId",
    component: ui.BlockContainer,
    redirect: envParentRedirectFn,
    tree: getEnvParentTree("block"),
  },

  // Org Users
  {
    routerPath: "/orgUsers/:userId",
    component: ui.UserContainer,
    redirect: userRedirectFn,
    tree: getUserTree("orgUser"),
  },

  // Cli Users
  {
    routerPath: "/cliUsers/:userId",
    component: ui.UserContainer,
    redirect: userRedirectFn,
    tree: getUserTree("cliUser"),
  },

  // My Org
  {
    routerPath: "/my-org",
    component: ui.MyOrgContainer,
    tree: [
      {
        routerPath: "/settings/environment-role-form/:editingId?",
        component: ui.EnvironmentRoleForm,
      },
      {
        routerPath: "/settings",
        component: ui.OrgSettings,
      },
      {
        routerPath: "/sso",
        component: ui.SingleSignOnSettings,
      },
      {
        routerPath: `/billing`,
        component: ui.Billing,
      },
      {
        routerPath: `/logs/:logManagerStateBs58?`,
        component: ui.LogManager,
      },
      {
        routerPath: `/recovery-key`,
        component: ui.ManageRecoveryKey,
      },
    ],
  },

  // Org Devices
  {
    routerPath: `/devices/:userId?`,
    component: ui.OrgDevices,
  },

  // Fallback Routes
  {
    routerPath: "/no-apps-or-blocks",
    component: ui.NoAppsOrBlocks,
  },
  {
    routerPath: "/not-found",
    component: ui.ObjectNotFound,
  },
];

const inviteRoutes: RouterTree = [
  {
    routerPath: "/invite-users/form/:editIndex?",
    component: ui.InviteForm,
  },
  {
    routerPath: "/invite-users/generated",
    component: ui.GeneratedInvites,
  },
  {
    routerPath: "/invite-users",
    component: ui.InviteUsers,
  },
];

const cliKeyRoutes: RouterTree = [
  {
    routerPath: "/new-cli-key",
    component: ui.NewCliUser,
  },
  {
    routerPath: "/generated-cli-key",
    component: ui.GeneratedCliUser,
  },
];

const getEnvParentTree = (envParentType: Model.EnvParent["type"]): RouterTree =>
  [
    {
      routerPath: "/environments/:environmentId?/:subRoute?/:subEnvironmentId?",
      component: ui.EnvManager,
    },

    getCollaboratorNode(envParentType, "orgUser"),

    getCollaboratorNode(envParentType, "cliUser"),

    envParentType == "app"
      ? {
          routerPath: "/envkeys",
          component: ui.AppEnvkeysContainer,
        }
      : undefined,

    envParentType == "block"
      ? {
          routerPath: "/apps",
          component: ui.BlockApps,
        }
      : undefined,
    {
      routerPath: "/settings",
      component: {
        app: ui.AppSettings,
        block: ui.BlockSettings,
      }[envParentType],
    },
    {
      routerPath: "/settings/environment-role-form/:editingId?",
      component: ui.EnvironmentRoleForm,
    },
    {
      routerPath: "/versions/:environmentOrLocalsUserId?/:filterEntryKeys?",
      component: ui.Versions,
    },
    {
      routerPath: `/logs/:logManagerStateBs58?`,
      component: ui.LogManager,
    },
    envParentType == "block"
      ? {
          routerPath: "/add-apps",
          component: ui.BlockAddApps,
        }
      : undefined,
  ].filter((node): node is RouterNode => Boolean(node));

const getUserTree = (
  userType: (Model.OrgUser | Model.CliUser)["type"]
): RouterTree => [
  {
    component: ui.UserApps,
    routerPath: `/apps/:appId?`,
  },
  {
    routerPath: "/add-apps",
    component: ui.UserAddApps,
  },
  {
    component: ui.UserBlocks,
    routerPath: `/blocks/:blockId?`,
  },
  {
    routerPath: "/devices",
    component: ui.UserDevices,
  },
  {
    routerPath: "/settings",
    component: {
      orgUser: ui.OrgUserSettings,
      cliUser: ui.CliUserSettings,
    }[userType],
  },
  {
    routerPath: `/logs/:logManagerStateBs58?`,
    component: ui.LogManager,
  },
];

const getCollaboratorNode = (
  envParentType: Model.EnvParent["type"],
  userType: (Model.OrgUser | Model.CliUser)["type"]
): RouterNode => ({
  routerPath: `/${
    {
      orgUser: "collaborators",
      cliUser: "cli-keys",
    }[userType]
  }`,
  component: {
    orgUser: {
      app: ui.AppCollaboratorsContainer,
      block: ui.BlockOrgUsers,
    },
    cliUser: {
      app: ui.AppCliUsersContainer,
      block: ui.BlockCliUsers,
    },
  }[userType][envParentType],
  tree: [
    ...(envParentType == "app" && userType == "orgUser"
      ? [
          {
            routerPath: "/list",
            component: ui.AppOrgUsers,
          },
          {
            routerPath: "/list/add",
            component: ui.AppAddOrgUsersContainer,
            tree: [
              { routerPath: "/existing", component: ui.AppAddOrgUsers },
              ...inviteRoutes,
            ],
          },
          {
            routerPath: "/teams",
            component: ui.AppTeams,
            tree: [
              {
                routerPath: "/add",
                component: ui.AppAddTeams,
              },
            ],
          },
        ]
      : []),

    ...(envParentType == "app" && userType == "cliUser"
      ? [
          {
            routerPath: "/list",
            component: ui.AppCliUsers,
          },
          {
            routerPath: "/list/add",
            component: ui.AppAddCliUsersContainer,
            tree: cliKeyRoutes,
          },
        ]
      : []),
  ],
});

type Props = {
  nested?: true;
  routerTree?: RouterTree;
};

export const OrgRoutes: OrgComponent<{}, Props> = (componentProps) => {
  const routes = (
    routesProps: OrgComponentProps<{}, { routerTree?: RouterTree }>
  ): Route[] => {
    const addedRoutes = new Set<string>();

    const routerTree = routesProps.routerTree ?? getRouterTree();

    return R.flatten(
      routerTree
        .map((node, i) => {
          const path =
            (routesProps.baseRouterPath ?? componentProps.match.path ?? "") +
            (node.routerPath ?? "");

          if (node.routerPath && !addedRoutes.has(path)) {
            addedRoutes.add(path);

            return (
              <Route
                key={i}
                path={path}
                render={getRenderFn(componentProps, routesProps, node, path)}
              />
            );
          } else if (node.tree) {
            return routes({
              ...routesProps,
              routerTree: node.tree,
              baseRouterPath: path,
            });
          }
        })
        .filter(Boolean)
    ) as Route[];
  };

  return (
    <div>
      <Switch>
        {routes(componentProps)}
        {componentProps.nested ? (
          ""
        ) : (
          <Redirect to={componentProps.orgRoute("/not-found")} />
        )}
      </Switch>
    </div>
  );
};

const getRenderFn =
  (
    componentProps: OrgComponentProps<{ orgId: string }, Props>,
    routesProps: OrgComponentProps,
    node: RouterNode,
    path: string
  ) =>
  (routeProps: RouteComponentProps<{ orgId: string }>) => {
    const childProps = {
      ...routesProps,
      ...routeProps,
      baseRouterPath: path,
      routeParams: {
        ...componentProps.routeParams,
        ...(routeProps.match?.params ?? {}),
      },
      routerTree: node.tree ?? [],
    };

    if (node.redirect) {
      const redirect = node.redirect(childProps);
      if (redirect) {
        return <Redirect to={redirect} />;
      }
    }

    if (!node.component) {
      return <OrgRoutes {...childProps} nested={true} />;
    }

    return routesProps.ui.loadedAccountId ? (
      <div>
        {React.createElement(node.component!, childProps)}
        {node.tree ? <OrgRoutes {...childProps} nested={true} /> : ""}
      </div>
    ) : (
      <div></div>
    );
  };

const envParentRedirectFn = (
  props: OrgComponentProps<{ appId: string } | { blockId: string }>
) => {
  const { graph } = props.core;

  let envParentId: string;
  let envParentType: Model.EnvParent["type"];
  if ("appId" in props.routeParams) {
    envParentId = props.routeParams.appId;
    envParentType = "app";
  } else {
    envParentId = props.routeParams.blockId;
    envParentType = "block";
  }

  const envParent = graph[envParentId] as Model.EnvParent | undefined;

  if (!envParent) {
    if (props.ui.justDeletedObjectId == envParentId) {
      props.setUiState(R.omit(["justDeletedObjectId"], props.ui));
    } else {
      alert(`This ${envParentType} has been removed or you have lost access.`);
    }

    return props.orgRoute("");
  }
  return false;
};

const userRedirectFn = (props: OrgComponentProps<{ userId: string }>) => {
  if (props.ui.justRegeneratedInviteForUserId == props.routeParams.userId) {
    return false;
  }
  const { graph } = props.core;
  const user = graph[props.routeParams.userId] as
    | Model.OrgUser
    | Model.CliUser
    | undefined;

  if (!user || user.deactivatedAt) {
    return props.orgRoute("");
  }
  return false;
};

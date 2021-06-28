import * as z from "zod";

// Eventually metadata will be added inside the object values, to describe their relation
// to other permissions, and what they do.
export const orgPermissions = {
    host_read_logs: {},
    self_hosted_upgrade: {},
    self_hosted_destroy_host: {},
    self_hosted_create_additional_orgs: {},

    org_manage_settings: {},
    org_rename: {},
    org_read_logs: {},
    org_manage_auth_settings: {},
    org_manage_users: {},
    org_manage_user_devices: {},
    org_invite_users_to_permitted_apps: {},
    org_approve_devices_for_permitted: {},
    org_manage_cli_users: {},
    org_create_cli_users_for_permitted_apps: {},
    org_delete: {},
    org_manage_billing: {},

    apps_create: {},
    apps_delete: {},
    apps_read_permitted: {},
    blocks_create: {},
    blocks_read_all: {},
    blocks_rename: {},
    blocks_manage_settings: {},
    blocks_write_envs_all: {},
    blocks_write_envs_permitted: {},
    blocks_manage_connections_permitted: {},
    blocks_manage_environments: {},
    blocks_delete: {},

    org_manage_firewall: {},
    org_manage_app_roles: {},
    org_manage_org_roles: {},
    org_manage_environment_roles: {},
    org_manage_user_groups: {},
    org_manage_app_groups: {},
    org_manage_block_groups: {},
    org_clear_tokens: {},
    org_generate_recovery_key: {},
  },
  appPermissions = {
    app_read: {},
    app_manage_users: {},
    app_approve_user_devices: {},
    app_manage_cli_users: {},
    app_read_own_locals: {},
    app_read_user_locals: {},
    app_read_user_locals_history: {},
    app_write_user_locals: {},
    app_manage_blocks: {},
    app_manage_environments: {},
    app_manage_servers: {},
    app_manage_local_keys: {},
    app_read_logs: {},
    app_manage_firewall: {},
    app_rename: {},
    app_manage_settings: {},
    app_manage_included_roles: {},
  },
  environmentWritePermissions = {
    write: {},
    write_subenvs: {},
  },
  environmentReadPermissions = {
    read: {},
    read_inherits: {},
    read_meta: {},
    read_history: {},
    read_subenvs: {},
    read_subenvs_inherits: {},
    read_subenvs_meta: {},
    read_subenvs_history: {},
  },
  environmentPermissions = {
    ...environmentWritePermissions,
    ...environmentReadPermissions,
  };

export const OrgPermissionSchema = z.enum(
  Object.keys(orgPermissions) as [
    keyof typeof orgPermissions,
    keyof typeof orgPermissions,
    ...(keyof typeof orgPermissions)[]
  ]
);
export type OrgPermission = z.infer<typeof OrgPermissionSchema>;

export const AppPermissionSchema = z.enum(
  Object.keys(appPermissions) as [
    keyof typeof appPermissions,
    keyof typeof appPermissions,
    ...(keyof typeof appPermissions)[]
  ]
);
export type AppPermission = z.infer<typeof AppPermissionSchema>;

export const EnvironmentWritePermissionSchema = z.enum(
  Object.keys(environmentWritePermissions) as [
    keyof typeof environmentWritePermissions,
    keyof typeof environmentWritePermissions,
    ...(keyof typeof environmentWritePermissions)[]
  ]
);
export type EnvironmentWritePermission = z.infer<
  typeof EnvironmentWritePermissionSchema
>;

export const EnvironmentReadPermissionSchema = z.enum(
  Object.keys(environmentReadPermissions) as [
    keyof typeof environmentReadPermissions,
    keyof typeof environmentReadPermissions,
    ...(keyof typeof environmentReadPermissions)[]
  ]
);
export type EnvironmentReadPermission = z.infer<
  typeof EnvironmentReadPermissionSchema
>;

export const EnvironmentPermissionSchema = z.enum(
  Object.keys(environmentPermissions) as [
    keyof typeof environmentPermissions,
    keyof typeof environmentPermissions,
    ...(keyof typeof environmentPermissions)[]
  ]
);
export type EnvironmentPermission = z.infer<typeof EnvironmentPermissionSchema>;

export const EnvironmentPermissionsSchema = z.record(
  z.array(EnvironmentPermissionSchema)
);
export type EnvironmentPermissions = z.infer<
  typeof EnvironmentPermissionsSchema
>;

export const EnvironmentReadPermissionsSchema = z.record(
  z.array(EnvironmentReadPermissionSchema)
);
export type EnvironmentReadPermissions = z.infer<
  typeof EnvironmentReadPermissionsSchema
>;

export const EnvironmentWritePermissionsSchema = z.record(
  z.array(EnvironmentWritePermissionSchema)
);
export type EnvironmentWritePermissions = z.infer<
  typeof EnvironmentWritePermissionsSchema
>;

export const DEFAULT_ORG_BASIC_USER_PERMISSIONS: OrgPermission[] = [
    "apps_read_permitted",
    "org_invite_users_to_permitted_apps",
    "org_create_cli_users_for_permitted_apps",
    "org_approve_devices_for_permitted",
    "blocks_write_envs_permitted",
    "blocks_manage_connections_permitted",
    "org_generate_recovery_key",
  ],
  DEFAULT_ORG_ADMIN_PERMISSIONS: OrgPermission[] = [
    ...DEFAULT_ORG_BASIC_USER_PERMISSIONS,
    "apps_create",
    "apps_delete",
    "blocks_create",
    "blocks_read_all",
    "blocks_rename",
    "blocks_manage_settings",
    "blocks_write_envs_all",
    "blocks_delete",
    "blocks_manage_environments",
    "org_manage_users",
    "org_manage_cli_users",
    "org_read_logs",
    "org_manage_app_roles",
    "org_manage_user_groups",
    "org_manage_app_groups",
    "org_manage_block_groups",
    "org_manage_environment_roles",
  ],
  DEFAULT_ORG_OWNER_PERMISSIONS = Object.keys(
    orgPermissions
  ) as OrgPermission[],
  DEFAULT_APP_DEVELOPER_PERMISSIONS: AppPermission[] = [
    "app_read",
    "app_manage_local_keys",
    "app_read_own_locals",
  ],
  DEFAULT_APP_DEVOPS_PERMISSIONS: AppPermission[] = [
    ...DEFAULT_APP_DEVELOPER_PERMISSIONS,
    "app_manage_blocks",
    "app_manage_servers",
  ],
  DEFAULT_APP_ADMIN_PERMISSIONS = Object.keys(
    appPermissions
  ) as AppPermission[],
  ENV_READ_PERMISSIONS: EnvironmentPermission[] = [
    "read",
    "read_inherits",
    "read_meta",
    "read_history",
  ],
  SUB_ENV_READ_PERMISSIONS: EnvironmentPermission[] = [
    "read_subenvs",
    "read_subenvs_inherits",
    "read_subenvs_meta",
    "read_subenvs_history",
  ],
  ENV_WRITE_PERMISSIONS: EnvironmentPermission[] = ["write"],
  SUB_ENV_WRITE_PERMISSIONS: EnvironmentPermission[] = ["write_subenvs"],
  ENVIRONMENT_READ_WRITE_PERMISSIONS = Array.from(
    new Set([
      ...ENV_READ_PERMISSIONS,
      ...ENV_WRITE_PERMISSIONS,
      ...SUB_ENV_READ_PERMISSIONS,
    ])
  ) as EnvironmentPermission[],
  ENVIRONMENT_DEVOPS_PERMISSIONS = Array.from(
    new Set([
      ...ENVIRONMENT_READ_WRITE_PERMISSIONS,
      ...SUB_ENV_WRITE_PERMISSIONS,
    ])
  ) as EnvironmentPermission[],
  ENVIRONMENT_FULL_PERMISSIONS = Array.from(
    new Set([...ENVIRONMENT_DEVOPS_PERMISSIONS])
  ) as EnvironmentPermission[],
  ENVIRONMENT_META_ONLY_PERMISSIONS: EnvironmentPermission[] = [
    "read_inherits",
    "read_meta",
    "read_subenvs_inherits",
    "read_subenvs_meta",
  ],
  ORG_PERMISSIONS_BY_DEFAULT_ROLE: {
    [name: string]: OrgPermission[];
  } = {
    "Basic User": DEFAULT_ORG_BASIC_USER_PERMISSIONS,
    "Org Admin": DEFAULT_ORG_ADMIN_PERMISSIONS,
    "Org Owner": DEFAULT_ORG_OWNER_PERMISSIONS,
  },
  APP_PERMISSIONS_BY_DEFAULT_ROLE: {
    [name: string]: AppPermission[];
  } = {
    Developer: DEFAULT_APP_DEVELOPER_PERMISSIONS,
    DevOps: DEFAULT_APP_DEVOPS_PERMISSIONS,
    Admin: DEFAULT_APP_ADMIN_PERMISSIONS,
    "Org Admin": DEFAULT_APP_ADMIN_PERMISSIONS,
    "Org Owner": DEFAULT_APP_ADMIN_PERMISSIONS,
  },
  ENVIRONMENT_PERMISSIONS_BY_DEFAULT_ROLE: {
    [name: string]: {
      [name: string]: EnvironmentPermission[];
    };
  } = {
    Developer: {
      Development: ENVIRONMENT_READ_WRITE_PERMISSIONS,
      Staging: ENVIRONMENT_READ_WRITE_PERMISSIONS,
      Production: ENVIRONMENT_META_ONLY_PERMISSIONS,
    },
    DevOps: {
      Development: ENVIRONMENT_DEVOPS_PERMISSIONS,
      Staging: ENVIRONMENT_DEVOPS_PERMISSIONS,
      Production: ENVIRONMENT_DEVOPS_PERMISSIONS,
    },
  };

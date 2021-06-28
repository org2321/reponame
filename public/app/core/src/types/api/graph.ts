import { Db } from "./db";

export namespace Graph {
  export type GraphObject =
    | Db.Org
    | Db.OrgRole
    | Db.AppRole
    | Db.EnvironmentRole
    | Db.AppRoleEnvironmentRole
    | Db.Group
    | Db.AppUserGroup
    | Db.AppGroupUserGroup
    | Db.AppGroupUser
    | Db.AppGroupBlock
    | Db.AppBlockGroup
    | Db.AppGroupBlockGroup
    | Db.Server
    | Db.LocalKey
    | Db.IncludedAppRole
    | Db.Environment
    | Db.VariableGroup
    | Db.GeneratedEnvkey
    | Db.OrgUserDevice
    | Db.OrgUser
    | Db.CliUser
    | Db.RecoveryKey
    | Db.DeviceGrant
    | Db.Invite
    | Db.App
    | Db.Block
    | Db.AppUserGrant
    | Db.AppBlock
    | Db.GroupMembership
    | Db.PubkeyRevocationRequest
    | Db.RootPubkeyReplacement
    | Db.ExternalAuthProvider
    | Db.File
    | Db.ScimProvisioningProvider;

  export type OrgGraph = {
    [id: string]: GraphObject;
  };
}

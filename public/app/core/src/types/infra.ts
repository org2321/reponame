import { Api } from ".";

export namespace Infra {
  export type ProjectType =
    | "api"
    | "desktop"
    | "infra"
    | "failover"
    | "cli"
    | "envkeyfetch"
    | "envkeysource";

  export type RequiredAwsCreds = {
    accessKeyId: string;
    secretAccessKey: string;
  };
  export type OptionalAwsCreds =
    | { accessKeyId: string; secretAccessKey: string }
    | undefined;

  export type DeploySelfHostedParams = {
    profile: string;
    domain: string;
    primaryRegion: string;
    verifiedSenderEmail: string;
    customDomain: boolean;
    registerAction: Api.Action.RequestActions["Register"];
    notifyEmailWhenDone?: string;
    notifySmsWhenDone?: string;
    apiVersionNumber?: string;
    infraVersionNumber?: string;
    failoverVersionNumber?: string;
    creds?: OptionalAwsCreds;
    overrideReleaseBucket?: string;
  };
}

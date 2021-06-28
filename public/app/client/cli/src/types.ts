export type BaseArgs = {
  $0: string;
  silent?: boolean;
  account?: string;
  org?: string;
  "cli-envkey"?: string;
  json?: boolean;
  verbose?: boolean;
  detectedEnvkey?: DetectedEnvkey
  // accountIdOverrideFromEnv?: string;
  // appIdOverrideFromEnv?: string;
};

export type DetectedEnvkey = {
  appId: string;
  appName: string;
  orgName: string;
  // orgUserId
  accountId: string;
  dotenvFile: string;
  foundEnvkey: string;
  envkeyFromEnvironment: boolean;
};

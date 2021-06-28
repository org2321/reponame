export type License = {
  type: "license";
  id: string;
  orgBillingId: string;
  plan: "free" | "paid";
  expiresAt: number;
  maxDevices: number;
  maxEnvkeys: number;
  maxCliUsers: number;
  maxCloudStorageMb: number;
  maxCloudApiCallsPerMonth: number;
  maxCloudDataTransferPerMonthGb: number;
  provisional?: true;
  createdAt: number;
  deletedAt?: number;
};

export type Tier = {
  label: string;
  maxDevices: number;
  maxEnvkeys: number;
  maxCliUsers: number;
  maxCloudStorageMb: number;
  maxCloudApiCallsPerMonth: number;
  maxCloudDataTransferPerMonthGb: number;
};

import { Billing } from "@core/types";
import { memoizeShallowAll as memoize } from "@core/lib/utils/memoize";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { sha256 } from "@core/lib/crypto/utils";
import { env } from "./env";

const BILLING_PUBKEY = "pA2oKBC6AuqsB9pGjYRph9Uf8UBBTeLbLFkeyqJc6Zs=";

/*
 * Default Free Tier License:
 * Max Devices: · 10
 * Max ENVKEYs: · 20
 * Max CLI Keys: · 10
 * Max Cloud Storage Megabytes: · 100
 * Max Cloud Api Calls Per Month: · 100000
 * Max Cloud Data Transfer Per Month Gigabytes: · 100
 */
const FREE_TIER_LICENSE =
  "G3uK+kt8YqMHM0u2pcmlFbJMmivc7mAN6Oyirbc3BGDZdMzmU44u5at9UAOGrxUXfmTAiT1u1D5mw2scBRxuAnsidHlwZSI6ImxpY2Vuc2UiLCJpZCI6IjM4Y2YzOTY0LWQxZDQtNDE1Mi1hMGNlLWFhN2I4Y2ZlNDMwMCIsIm9yZ0JpbGxpbmdJZCI6IioiLCJwbGFuIjoiZnJlZSIsImNyZWF0ZWRBdCI6MTYxNDI5ODYxMTg3MywiZXhwaXJlc0F0IjotMSwibWF4RGV2aWNlcyI6MTAsIm1heEVudmtleXMiOjIwLCJtYXhDbGlVc2VycyI6MTAsIm1heENsb3VkU3RvcmFnZU1iIjoxMDAsIm1heENsb3VkQXBpQ2FsbHNQZXJNb250aCI6MTAwMDAwLCJtYXhDbG91ZERhdGFUcmFuc2ZlclBlck1vbnRoR2IiOjEwMH0=";

export const verifySignedLicense = memoize(
  (
    orgId: string,
    signedLicense: string | undefined,
    now: number,
    enforceExpiration: boolean = true
  ) => {
    const signed = signedLicense ?? FREE_TIER_LICENSE;

    const verified = nacl.sign.open(
      naclUtil.decodeBase64(signed),
      naclUtil.decodeBase64(BILLING_PUBKEY)
    );

    if (!verified) {
      throw new Error("Invalid license");
    }

    const license = JSON.parse(
      naclUtil.encodeUTF8(verified)
    ) as Billing.License;

    if (
      license.type != "license" ||
      !license.id ||
      !license.orgBillingId ||
      !license.plan ||
      !license.createdAt ||
      !license.expiresAt ||
      !license.maxDevices ||
      !license.maxEnvkeys ||
      !license.maxCloudStorageMb
    ) {
      throw new Error("Invalid license");
    }

    if (
      license.orgBillingId != "*" &&
      license.orgBillingId != getOrgBillingId(orgId)
    ) {
      throw new Error("Invalid license");
    }

    if (license.expiresAt != -1 && enforceExpiration) {
      const gracePeriod = 7 * 24 * 60 * 60 * 1000; // 7 days
      if (now > license.expiresAt + gracePeriod) {
        throw new Error("License expired");
      }
    }

    return license;
  }
);

export const getOrgBillingId = memoize((orgId: string) =>
  sha256(
    JSON.stringify([orgId, env.DEPLOYMENT_TAG, env.DOMAIN].filter(Boolean))
  )
);

export const BILLING_TIERS: Billing.Tier[] = [
  {
    // 10k
    label: "Business",
    maxDevices: 25,
    maxEnvkeys: 50,
    maxCliUsers: 25,
    maxCloudStorageMb: 10000,
    maxCloudApiCallsPerMonth: 1000000,
    maxCloudDataTransferPerMonthGb: 1000,
  },
  {
    // 20k
    label: "Growth",
    maxDevices: 50,
    maxEnvkeys: 100,
    maxCliUsers: 50,
    maxCloudStorageMb: 20000,
    maxCloudApiCallsPerMonth: 2000000,
    maxCloudDataTransferPerMonthGb: 2000,
  },
  {
    // 40k
    label: "Enterprise 1",
    maxDevices: 100,
    maxEnvkeys: 200,
    maxCliUsers: 100,
    maxCloudStorageMb: 40000,
    maxCloudApiCallsPerMonth: 4000000,
    maxCloudDataTransferPerMonthGb: 4000,
  },
  {
    // 80k
    label: "Enterprise 2",
    maxDevices: 200,
    maxEnvkeys: 400,
    maxCliUsers: 200,
    maxCloudStorageMb: 80000,
    maxCloudApiCallsPerMonth: 8000000,
    maxCloudDataTransferPerMonthGb: 8000,
  },
  {
    // 160k
    label: "Enterprise 3",
    maxDevices: 400,
    maxEnvkeys: 800,
    maxCliUsers: 400,
    maxCloudStorageMb: 160000,
    maxCloudApiCallsPerMonth: 16000000,
    maxCloudDataTransferPerMonthGb: 16000,
  },
  {
    // 320k
    label: "Enterprise 4",
    maxDevices: 800,
    maxEnvkeys: 1600,
    maxCliUsers: 800,
    maxCloudStorageMb: 320000,
    maxCloudApiCallsPerMonth: 32000000,
    maxCloudDataTransferPerMonthGb: 32000,
  },
  {
    // 640k
    label: "Enterprise 5",
    maxDevices: 1600,
    maxEnvkeys: 3200,
    maxCliUsers: 1600,
    maxCloudStorageMb: 640000,
    maxCloudApiCallsPerMonth: 64000000,
    maxCloudDataTransferPerMonthGb: 64000,
  },
  {
    // 1.28mm
    label: "Enterprise 6",
    maxDevices: 3200,
    maxEnvkeys: 6400,
    maxCliUsers: 3200,
    maxCloudStorageMb: 1280000,
    maxCloudApiCallsPerMonth: 128000000,
    maxCloudDataTransferPerMonthGb: 128000,
  },
];

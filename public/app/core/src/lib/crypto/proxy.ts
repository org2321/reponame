import workerpool from "workerpool";
import { Crypto } from "../../types";
import path from "path";
import { log } from "../utils/logger";

export type WorkerPool = workerpool.WorkerPool;

interface WorkerProxy {
  signingKeypair: () => Promise<{ publicKey: string; secretKey: string }>;
  encryptionKeypair: () => Promise<{ publicKey: string; secretKey: string }>;
  encrypt: (
    params: { data: string } & Crypto.Keypair
  ) => Promise<Crypto.EncryptedData>;
  encryptJson: (
    params: { data: object } & Crypto.Keypair
  ) => Promise<Crypto.EncryptedData>;
  decrypt: (
    params: { encrypted: Crypto.EncryptedData } & Crypto.Keypair
  ) => Promise<string | null>;
  signJson: (params: {
    data: object;
    privkey: Crypto.Privkey;
  }) => Promise<string>;
  verifyJson: (params: {
    signed: string;
    pubkey: Crypto.Pubkey;
  }) => Promise<object | null>;
  encryptSymmetricWithKey: (params: {
    data: string;
    encryptionKey: string;
  }) => Promise<Crypto.EncryptedData>;
  encryptSymmetricWithPassphrase: (params: {
    data: string;
    passphrase: string;
  }) => Promise<Crypto.PassphraseEncryptedData>;
  decryptSymmetricWithKey: (params: {
    encrypted: Crypto.EncryptedData;
    encryptionKey: string;
  }) => Promise<string | null>;
  decryptSymmetricWithPassphrase: (params: {
    encrypted: Crypto.PassphraseEncryptedData;
    passphrase: string;
  }) => Promise<string | null>;
  encryptPrivateKey: (params: {
    privkey: Crypto.Privkey;
    encryptionKey: string;
  }) => Promise<Crypto.EncryptedData>;
  encryptPrivateKeyWithPassphrase: (params: {
    privkey: Crypto.Privkey;
    passphrase: string;
  }) => Promise<Crypto.PassphraseEncryptedData>;
  decryptPrivateKey: (params: {
    encryptedPrivkey: Crypto.EncryptedData;
    encryptionKey: string;
  }) => Promise<Crypto.Privkey | null>;
  decryptPrivateKeyWithPassphrase: (params: {
    encryptedPrivkey: Crypto.PassphraseEncryptedData;
    passphrase: string;
  }) => Promise<Crypto.Privkey | null>;
  signPublicKey: (params: {
    privkey: Crypto.Privkey;
    pubkey: Crypto.Pubkey;
  }) => Promise<Crypto.Pubkey>;
  verifyPublicKeySignature: (params: {
    signedPubkey: Crypto.Pubkey;
    signerPubkey: Crypto.Pubkey;
  }) => Promise<boolean>;
}

if (typeof window != "undefined") {
  console.log("using crypto worker from browser");
  throw new Error("using crypto worker from browser");
}

declare var process: {
  resourcesPath: string;
  env: {
    CRYPTO_WORKER_PATH_FROM_ELECTRON_EXTRA_RESOURCES?: string;
    CRYPTO_WORKER_PATH?: string;
    IS_ELECTRON?: string;
  };
};

let workerPath: string;

// electron desktop workarounds - may or may not be node.js process var
if (
  process.env["CRYPTO_WORKER_PATH_FROM_ELECTRON_EXTRA_RESOURCES"] &&
  process.resourcesPath
) {
  workerPath = path.resolve(
    process.resourcesPath,
    "extraResources/",
    process.env["CRYPTO_WORKER_PATH_FROM_ELECTRON_EXTRA_RESOURCES"]
  );
} else if (process.env["CRYPTO_WORKER_PATH"]) {
  // probably the CLI
  workerPath = process.env["CRYPTO_WORKER_PATH"];
} else {
  workerPath = path.resolve(__dirname, "../../../build/worker.js"); // development
}

let workerPool = workerpool.pool(workerPath, {
    workerType: process.env.IS_ELECTRON ? "process" : "thread",
    minWorkers: "max",
  }),
  proxyPromise = (<any>workerPool.proxy()) as Promise<WorkerProxy>;

export const terminateWorkerPool = async () => {
  await workerPool?.terminate(true);
  (workerPool as any) = null;
  (proxyPromise as any) = null;
};

export const generateKeys = async function (
    params: {
      passphrase?: string;
      encryptionKey?: string;
    } = {}
  ): Promise<{
    pubkey: Crypto.Pubkey;
    privkey: Crypto.Privkey;
    encryptedPrivkey?: Crypto.EncryptedData | Crypto.PassphraseEncryptedData;
  }> {
    const { passphrase, encryptionKey } = params;

    const proxy: WorkerProxy = await proxyPromise,
      [
        { publicKey: encryptionPubkey, secretKey: encryptionPrivkey },
        { publicKey: signingPubkey, secretKey: signingPrivkey },
      ] = await Promise.all([
        proxy.encryptionKeypair(),
        proxy.signingKeypair(),
      ]),
      pubkey: Crypto.Pubkey = {
        keys: {
          signingKey: signingPubkey,
          encryptionKey: encryptionPubkey,
        },
      },
      privkey: Crypto.Privkey = {
        keys: {
          signingKey: signingPrivkey,
          encryptionKey: encryptionPrivkey,
        },
      };

    let encryptedPrivkey:
      | Crypto.EncryptedData
      | Crypto.PassphraseEncryptedData
      | undefined;
    if (passphrase || encryptionKey) {
      encryptedPrivkey = passphrase
        ? await encryptPrivateKeyWithPassphrase({ privkey, passphrase })
        : await encryptPrivateKey({
            privkey,
            encryptionKey: encryptionKey!,
          });
    }

    return { pubkey, privkey, encryptedPrivkey };
  },
  ephemeralEncryptionKeypair = async function (): Promise<Crypto.Keypair> {
    const proxy: WorkerProxy = await proxyPromise,
      { publicKey, secretKey } = await proxy.encryptionKeypair();

    return {
      pubkey: {
        keys: {
          encryptionKey: publicKey,
          signingKey: "",
        },
      },
      privkey: {
        keys: {
          encryptionKey: secretKey,
          signingKey: "",
        },
      },
    };
  },
  encrypt = async function (
    params: { data: string } & Crypto.Keypair
  ): Promise<Crypto.EncryptedData> {
    const proxy: WorkerProxy = await proxyPromise;
    return proxy.encrypt(params);
  },
  encryptJson = async function (
    params: { data: object } & Crypto.Keypair
  ): Promise<Crypto.EncryptedData> {
    const proxy: WorkerProxy = await proxyPromise;
    return proxy.encryptJson(params);
  },
  decryptJson = async function (
    params: { encrypted: Crypto.EncryptedData } & Crypto.Keypair
  ): Promise<object> {
    const proxy: WorkerProxy = await proxyPromise;
    const decrypted = await proxy.decrypt(params);
    if (decrypted === null) throw new Error("Decryption authentication failed");
    return JSON.parse(decrypted);
  },
  decrypt = async function (
    params: { encrypted: Crypto.EncryptedData } & Crypto.Keypair
  ): Promise<string> {
    const proxy: WorkerProxy = await proxyPromise;
    const decrypted = await proxy.decrypt(params);
    if (decrypted === null) throw new Error("Decryption authentication failed");
    return decrypted;
  },
  signJson = async function (params: {
    data: object;
    privkey: Crypto.Privkey;
  }): Promise<string> {
    const proxy: WorkerProxy = await proxyPromise;
    return proxy.signJson(params);
  },
  verifyJson = async function (params: {
    signed: string;
    pubkey: Crypto.Pubkey;
  }): Promise<object> {
    const proxy: WorkerProxy = await proxyPromise;
    const verified = await proxy.verifyJson(params);
    if (verified === null) throw new Error("Signature invalid");
    return verified;
  },
  decryptPrivateKey = async function (params: {
    encryptedPrivkey: Crypto.EncryptedData;
    encryptionKey: string;
  }): Promise<Crypto.Privkey> {
    const proxy: WorkerProxy = await proxyPromise;
    const decrypted = await proxy.decryptPrivateKey(params);
    if (decrypted === null) throw new Error("Private key decryption failed");
    return decrypted;
  },
  decryptSymmetricWithKey = async function (params: {
    encrypted: Crypto.EncryptedData;
    encryptionKey: string;
  }): Promise<string> {
    const proxy: WorkerProxy = await proxyPromise;
    const decrypted = await proxy.decryptSymmetricWithKey(params);
    if (decrypted === null) throw new Error("Decryption failed");
    return decrypted;
  },
  decryptSymmetricWithPassphrase = async function (params: {
    encrypted: Crypto.PassphraseEncryptedData;
    passphrase: string;
  }): Promise<string> {
    const proxy: WorkerProxy = await proxyPromise;
    const decrypted = await proxy.decryptSymmetricWithPassphrase(params);
    if (decrypted === null) throw new Error("Decryption failed");
    return decrypted;
  },
  decryptPrivateKeyWithPassphrase = async function (params: {
    encryptedPrivkey: Crypto.PassphraseEncryptedData;
    passphrase: string;
  }): Promise<Crypto.Privkey> {
    const proxy: WorkerProxy = await proxyPromise;
    const decrypted = await proxy.decryptPrivateKeyWithPassphrase(params);
    if (decrypted === null) throw new Error("Private key decryption failed");
    return decrypted;
  },
  encryptSymmetricWithKey = async function (params: {
    data: string;
    encryptionKey: string;
  }): Promise<Crypto.EncryptedData> {
    const proxy: WorkerProxy = await proxyPromise;
    return proxy.encryptSymmetricWithKey(params);
  },
  encryptSymmetricWithPassphrase = async function (params: {
    data: string;
    passphrase: string;
  }): Promise<Crypto.PassphraseEncryptedData> {
    const proxy: WorkerProxy = await proxyPromise;
    return proxy.encryptSymmetricWithPassphrase(params);
  },
  encryptPrivateKey = async function (params: {
    privkey: Crypto.Privkey;
    encryptionKey: string;
  }): Promise<Crypto.EncryptedData> {
    const proxy: WorkerProxy = await proxyPromise;
    return proxy.encryptPrivateKey(params);
  },
  encryptPrivateKeyWithPassphrase = async function (params: {
    privkey: Crypto.Privkey;
    passphrase: string;
  }): Promise<Crypto.PassphraseEncryptedData> {
    const proxy: WorkerProxy = await proxyPromise;
    return proxy.encryptPrivateKeyWithPassphrase(params);
  },
  signPublicKey = async function (params: {
    privkey: Crypto.Privkey;
    pubkey: Crypto.Pubkey;
  }): Promise<Crypto.Pubkey> {
    const proxy: WorkerProxy = await proxyPromise;
    return proxy.signPublicKey(params);
  },
  verifyPublicKeySignature = async function (params: {
    signedPubkey: Crypto.Pubkey;
    signerPubkey: Crypto.Pubkey;
  }): Promise<boolean> {
    const proxy: WorkerProxy = await proxyPromise;
    if (!params.signedPubkey.signature) throw new Error("Pubkey is not signed");
    return proxy.verifyPublicKeySignature(params);
  };

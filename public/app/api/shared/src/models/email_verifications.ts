import { sha256 } from "@core/lib/crypto/utils";
import { getDb, query } from "../db";
import { Api } from "@core/types";
import { pick } from "@core/lib/utils/pick";

export const getEmailVerificationPkey = (email: string) =>
    [email.toLowerCase().trim(), "verifications"].join("|"),
  getActiveEmailVerification = async (email: string, token: string) => {
    const emailVerification = await getDb<Api.Db.EmailVerification>(
      {
        pkey: getEmailVerificationPkey(email),
        skey: token,
      },
      { deleted: false }
    );

    if (
      !emailVerification ||
      sha256(token) !== sha256(emailVerification.token)
    ) {
      return undefined;
    }

    return emailVerification;
  },
  getActiveVerificationsWithEmail = async (email: string) =>
    query<Api.Db.EmailVerification>({
      pkey: getEmailVerificationPkey(email),
      deleted: false,
    }),
  verifyEmailVerificationTransactionItems = (
    emailVerification: Api.Db.EmailVerification,
    now: number
  ): Api.Db.ObjectTransactionItems => {
    if (emailVerification.deletedAt) {
      throw new Error(
        "cannot verify an email verification that has already been revoked"
      );
    }

    if (emailVerification.verifiedAt) {
      throw new Error(
        "cannot verify an email verification that has already been verified"
      );
    }

    return {
      updates: [
        [
          pick(["pkey", "skey"], emailVerification),
          {
            ...emailVerification,
            verifiedAt: now,
            updatedAt: now,
            deletedAt: now,
            pkey: getEmailVerificationPkey(emailVerification.email),
          } as Api.Db.EmailVerification,
        ],
      ],
    };
  };

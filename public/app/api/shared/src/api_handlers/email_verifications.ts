import { getEmailVerificationPkey } from "../models/email_verifications";
import { pick } from "@core/lib/utils/pick";
import { apiAction, apiErr } from "../handler";
import { Api } from "@core/types";
import * as R from "ramda";
import { getUserIdsWithEmail } from "../models/users";
import { getOrg, getOrgUser } from "../models/orgs";
import {
  getActiveEmailVerification,
  getActiveVerificationsWithEmail,
} from "../models/email_verifications";
import { env } from "../env";
import { sendEmail } from "../email";
import { secureRandomAlphanumeric } from "@core/lib/crypto/utils";
import { log } from "@core/lib/utils/logger";

apiAction<
  Api.Action.RequestActions["CreateEmailVerification"],
  Api.Net.ApiResultTypes["CreateEmailVerification"]
>({
  type: Api.ActionType.CREATE_EMAIL_VERIFICATION,
  graphAction: false,
  authenticated: false,
  handler: async ({ payload }, now, requestParams, transactionConn) => {
    // Check for situations where a user is already registered with this email / a different provider
    // Also check for currently outstanding email verifications using this email so we can mark them revoked later

    const email = payload.email.toLowerCase().trim(),
      [userIdsWithEmail, activeVerificationsWithEmail] = await Promise.all([
        getUserIdsWithEmail(email),
        getActiveVerificationsWithEmail(email),
      ]),
      usersWithOrgIdsForEmail =
        userIdsWithEmail.length > 0
          ? await Promise.all(
              userIdsWithEmail.map(
                ({ orgId, userId }: Api.Db.OrgUserIdByEmail) =>
                  getOrgUser(orgId, userId).then(
                    (user) => [user, orgId] as [Api.Db.OrgUser, string]
                  )
              )
            ).then((users) =>
              users.filter(
                ([user, orgId]) =>
                  user && !user.deletedAt && !user.deactivatedAt
              )
            )
          : [],
      usersWithEmail = usersWithOrgIdsForEmail.map(([user]) => user);

    let user: Api.Db.OrgUser | undefined;

    if (payload.authType == "sign_in") {
      const [emailProviderUsers, nonEmailProviderUsers] = R.partition(
        R.propEq("provider", "email"),
        usersWithEmail
      );

      if (nonEmailProviderUsers.length > 0 && !payload.confirmEmailProvider) {
        const res: Api.Net.SignInWrongProviderErrorResult = {
          type: "signInWrongProviderError",
          error: true,
          errorReason:
            "Sign-in with email is not supported. Please choose another provider.",
          providers: nonEmailProviderUsers.map((user) => ({
            provider: user.provider,
            externalAuthProviderId: user.externalAuthProviderId!,
          })),
        };
        return {
          type: "handlerResult",
          logTargetIds: [],
          response: res,
        };
      } else if (emailProviderUsers.length == 0) {
        throw await apiErr(transactionConn, "not found", 404);
      } else {
        user = emailProviderUsers[0];
      }
    }

    const token = secureRandomAlphanumeric(26);

    if (process.env.NODE_ENV == "development") {
      const clipboardy = require("clipboardy");
      const notifier = require("node-notifier");
      clipboardy.writeSync(token);
      notifier.notify("Created email verification. Token copied to clipboard.");
    }

    const emailVerification: Api.Db.EmailVerification = {
        type: "emailVerification",
        pkey: getEmailVerificationPkey(email),
        skey: token,
        token,
        email,
        userId: user ? user.id : undefined,
        authType: payload.authType,
        expiresAt: now + parseInt(env.EMAIL_TOKEN_EXPIRATION_MS ?? "86400000"),
        createdAt: now,
        updatedAt: now,
      },
      transactionItems: Api.Db.ObjectTransactionItems = {
        puts: [emailVerification],
      };

    // Revoke any outstanding emailVerifications with this email address
    if (activeVerificationsWithEmail.length > 0) {
      transactionItems.softDeleteKeys = activeVerificationsWithEmail.map((ev) =>
        pick(["pkey", "skey"], ev)
      );
    }

    return {
      type: "handlerResult",
      response: { type: "success" },
      transactionItems,
      logTargetIds: [],
      postUpdateActions: [
        async () =>
          sendEmail({
            to: email,
            subject:
              payload.authType == "sign_up"
                ? "Here's your Sign Up Token for EnvKey"
                : `${user!.firstName}, here's your Sign In Token for EnvKey`,
            bodyMarkdown:
              payload.authType == "sign_up"
                ? `Hi there,

Welcome to EnvKey! Here's your single-use token for signing up:

**${token}**

It will remain valid for the next 24 hours.

You can reply directly to this email with any questions or feedback.
`
                : `Hi ${user!.firstName},

Welcome back to EnvKey! Here's your single-use token for signing in:

**${token}**

It will remain valid for the next 24 hours.

You can reply directly to this email with any questions or feedback.
`,
          }),
      ],
    };
  },
});

apiAction<
  Api.Action.RequestActions["CheckEmailTokenValid"],
  Api.Net.ApiResultTypes["CheckEmailTokenValid"]
>({
  type: Api.ActionType.CHECK_EMAIL_TOKEN_VALID,
  graphAction: false,
  authenticated: false,
  handler: async ({ payload }, now, requestParams, transactionConn) => {
    const emailVerification = await getActiveEmailVerification(
      payload.email,
      payload.token
    );

    if (emailVerification) {
      return {
        type: "handlerResult",
        logTargetIds: [],
        response: { type: "success" },
      };
    } else {
      throw await apiErr(transactionConn, "email token invalid", 401);
    }
  },
});

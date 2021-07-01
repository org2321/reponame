import crypto from "crypto";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { env } from "./env";
import marked from "marked";
import { log, logStderr } from "@core/lib/utils/logger";
import { newMemoryQueue } from "./memory_queue";

type CustomEmail = {
  to: string;
  subject: string;
  bodyMarkdown: string;
};

const PlainTextRenderer = require("marked-plaintext");
const plainTextRenderer = new PlainTextRenderer();

// Note: we cannot use nodemailer's SES well-known transport due to our VPC configuration, which
// would have supported throttling via `sendingRate` prop (which isn't available for other
// built-ins or direct transport, which we use).

const emailsPerSecond = parseInt(env.EMAILS_PER_SECOND || "1", 10);
const maxMailRetryCount = 4;
// default SES limit is 1 email per sec, 200 per day, which customers may have on first launch
const { enqueue: enqueueFailedEmail } = newMemoryQueue(
  "email-retry-queue",
  5000,
  0,
  Math.ceil(emailsPerSecond / 2),
  maxMailRetryCount
);

const { enqueue: enqueueBulkEmail } = newMemoryQueue(
  "email-bulk-queue",
  5000,
  1050,
  Math.ceil(emailsPerSecond / 2),
  maxMailRetryCount
);

let transporter: Mail | undefined;
const asyncVerify = () =>
  new Promise<void>((resolve, reject) => {
    transporter?.verify((err) => (err ? reject(err) : resolve()));
  });

const verifySMTP = async () => {
  try {
    await asyncVerify();
    log("SMTP settings were verified successfully.");
  } catch (err) {
    logStderr("SMTP settings failed to be verified.", { err });
  }
};

const sesSmtpHostInternal = `email-smtp.${process.env.AWS_REGION}.amazonaws.com`;
let accessKeyId: string;
let secretAccessKey: string;
let hashedAccessKey: string;

if (env.NODE_ENV === "production" && env.SES_SMTP_CREDENTIALS_JSON) {
  ({ accessKeyId, secretAccessKey } = JSON.parse(
    env.SES_SMTP_CREDENTIALS_JSON
  ));
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new TypeError("Missing env var AWS_REGION in production mode!");
  }
  hashedAccessKey = secretKeyToSmtpPass(secretAccessKey, region);
  transporter = nodemailer.createTransport({
    host: sesSmtpHostInternal,
    port: 587,

    // This means to wait for STARTTLS, otherwise Error: "ssl3_get_record:wrong version number"
    // will happen if the connection opens with TLS at the start.
    secure: false,

    auth: {
      // Will use PLAIN auth according to what's supported by AWS
      user: accessKeyId,
      pass: hashedAccessKey,
    },
    tls: {
      // ignore self-signed certs or other invalid certs since we are inside the VPC
      rejectUnauthorized: false,
    },
  });
} else if (env.SMTP_TRANSPORT_JSON) {
  transporter = nodemailer.createTransport(JSON.parse(env.SMTP_TRANSPORT_JSON));
} else {
  logStderr("SMTP missing or disabled. EnvKey may not work correctly.");
}

if (transporter) {
  verifySMTP();
}

// sendEmail will immediately attempt to send the mail, then queue retries if it fails
export const sendEmail = async (email: CustomEmail) => {
  const { to, subject, bodyMarkdown } = email;
  const emailData = {
    to,
    from: process.env.VERIFIED_SENDER_EMAIL,
    subject,
    text: marked(bodyMarkdown, { renderer: plainTextRenderer }),
    html: marked(bodyMarkdown),
  };

  if (!transporter) {
    console.log("Not sending email in dev mode. Data:");
    console.log(JSON.stringify(emailData, null, 2));
    return;
  }

  // send email immediately, but queue to retry on failure

  log("Sending email immediately", { to, subject });
  return transporter.sendMail(emailData).catch((err) => {
    const task = async () => transporter?.sendMail(emailData);
    task.toString = () => `sendEmail(${JSON.stringify(email)})`;

    logStderr("Initial sendEmail failed, queuing for later.", { err, task });

    enqueueFailedEmail(task);
  });
};

// sendBulkEmail will put the email into the bulk outgoing queue to be delivered serially
export const sendBulkEmail = async (email: CustomEmail) => {
  const { to, subject, bodyMarkdown } = email;
  const emailData = {
    to,
    from: process.env.VERIFIED_SENDER_EMAIL,
    subject,
    text: marked(bodyMarkdown, { renderer: plainTextRenderer }),
    html: marked(bodyMarkdown),
  };

  if (!transporter) {
    console.log("Not sending bulk email in dev mode. Data:");
    console.log(JSON.stringify(emailData, null, 2));
    return;
  }

  const task = async () => transporter?.sendMail(emailData);
  task.toString = () => `sendBulkEmail(${JSON.stringify(email)})`;
  enqueueBulkEmail(task);
  log("Enqueued bulk email", { to, subject });
};

/* local funcs */

// https://docs.aws.amazon.com/ses/latest/DeveloperGuide/smtp-credentials.html
function secretKeyToSmtpPass(secretAccessKey: string, region: string): string {
  const sign = (key: Buffer, msg: string) =>
    crypto.createHmac("sha256", key).update(msg).digest();

  // The values of the following variables should always stay the same.
  const date = "11111111";
  const service = "ses";
  const message = "SendRawEmail";
  const terminal = "aws4_request";
  const versionInBytes = Buffer.from([0x04]);

  let signature = sign(Buffer.from("AWS4" + secretAccessKey, "utf-8"), date);
  signature = sign(signature, region);
  signature = sign(signature, service);
  signature = sign(signature, terminal);
  signature = sign(signature, message);

  const signatureAndVersion = Buffer.concat([versionInBytes, signature]);

  return signatureAndVersion.toString("base64");
}

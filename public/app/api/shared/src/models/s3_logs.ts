// Note: separate file because it is shared with failover, which would have required extra work
// to webpack mysql stuff

/**
 * formatted like:
 *
 *     5sLdELfbjLGSLVhM8DTY||98.36.130.6||1602014524361||1712||ee140e15-a9d1-4d25-bb9a-dbcb0830e92a
 */
type S3LogKey = string;

export type S3LogKeyParts = {
  envkeyIdPart: string;
  ip: string;
  timestamp: number;
  transactionId: string;
  contentLength: number;
};

export const getS3LogKey = (parts: S3LogKeyParts): S3LogKey => {
  const { envkeyIdPart, ip, timestamp, contentLength, transactionId } = parts;
  return [envkeyIdPart, ip, timestamp, contentLength, transactionId].join("||");
};
/**
 * @throws {TypeError}
 */
export const s3LogKeyToParts = (s3ObjectKey: string): S3LogKeyParts => {
  const [
    envkeyIdPart,
    ip,
    timestamp,
    contentLength,
    transactionId,
  ] = s3ObjectKey.split("||");

  if (!envkeyIdPart || !ip || !timestamp || !transactionId) {
    throw new TypeError(`S3LogKeyParts cannot be inferred from ${s3ObjectKey}`);
  }
  return {
    envkeyIdPart,
    ip,
    timestamp: parseInt(timestamp, 10),
    contentLength: parseInt(contentLength, 10),
    transactionId,
  };
};

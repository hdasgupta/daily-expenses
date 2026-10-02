import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

const enabled = Boolean(env.s3Bucket && env.s3AccessKeyId && env.s3SecretAccessKey);
const client = enabled
  ? new S3Client({
      region: env.s3Region,
      endpoint: env.s3Endpoint || undefined,
      forcePathStyle: Boolean(env.s3Endpoint),
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
      },
    })
  : null;

export function isStorageConfigured() {
  return Boolean(client);
}

export async function uploadObject(key, buffer, contentType) {
  if (!client) throw new Error("S3-compatible storage is not configured");
  await client.send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
  return key;
}

export async function getObject(key) {
  if (!client) return null;
  return client.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
}

export async function signedObjectUrl(key) {
  if (!client) return null;
  return getSignedUrl(client, new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }), {
    expiresIn: 900,
  });
}

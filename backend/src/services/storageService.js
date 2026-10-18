import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

function isValidHttpUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const validEndpoint = isValidHttpUrl(env.s3Endpoint) ? env.s3Endpoint : undefined;
const enabled = Boolean(env.s3Bucket && env.s3AccessKeyId && env.s3SecretAccessKey);

let client = null;
if (enabled) {
  try {
    client = new S3Client({
      region: env.s3Region || "us-east-2",
      endpoint: validEndpoint,
      forcePathStyle: Boolean(validEndpoint),
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
      },
    });
  } catch (error) {
    console.error("Failed to initialize S3 client", error);
    client = null;
  }
}

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

export async function signedObjectUrl(key) {
  if (!client || !key) return null;
  try {
    return await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }),
      {
        expiresIn: 900,
      },
    );
  } catch (error) {
    console.error("Failed to generate signed proof URL", {
      key,
      error: error?.message || String(error),
    });
    return null;
  }
}

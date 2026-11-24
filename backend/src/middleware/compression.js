import zlib from "node:zlib";

const COMPRESSIBLE_CONTENT_TYPE_RE =
  /^(?:application\/json|text\/|application\/javascript|application\/xml|image\/svg\+xml)/i;

const MIN_COMPRESS_BYTES = 1024;

export function compressionMiddleware(req, res, next) {
  if (req.method === "HEAD") {
    return next();
  }

  const acceptEncoding = String(req.headers["accept-encoding"] || "");
  const supportsGzip = /\bgzip\b/i.test(acceptEncoding);
  if (!supportsGzip) {
    return next();
  }

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  function shouldCompress(bodyBuffer) {
    if (!bodyBuffer || bodyBuffer.length < MIN_COMPRESS_BYTES) return false;
    if (res.headersSent) return false;
    if (res.getHeader("Content-Encoding")) return false;
    const contentType = String(res.getHeader("Content-Type") || "");
    if (contentType && !COMPRESSIBLE_CONTENT_TYPE_RE.test(contentType)) return false;
    return true;
  }

  function sendCompressed(body, fallback) {
    const buffer = Buffer.isBuffer(body)
      ? body
      : typeof body === "string"
        ? Buffer.from(body, "utf8")
        : null;

    if (!shouldCompress(buffer)) {
      return fallback(body);
    }

    zlib.gzip(buffer, { level: zlib.constants.Z_DEFAULT_COMPRESSION }, (err, compressed) => {
      if (err || res.headersSent) {
        return fallback(body);
      }

      res.removeHeader("Content-Length");
      res.setHeader("Content-Encoding", "gzip");
      res.vary("Accept-Encoding");
      return res.end(compressed);
    });
    return res;
  }

  res.json = (payload) => {
    if (!res.getHeader("Content-Type")) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    const serialized = JSON.stringify(payload);
    return sendCompressed(serialized, () => originalJson(payload));
  };

  res.send = (body) => {
    if (typeof body === "string" || Buffer.isBuffer(body)) {
      return sendCompressed(body, () => originalSend(body));
    }
    return originalSend(body);
  };

  return next();
}

function requestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function requestLogger(req, res, next) {
  const id = String(req.headers["x-request-id"] || requestId());
  const startedAt = process.hrtime.bigint();

  req.requestId = id;
  res.setHeader("X-Request-Id", id);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const memory = process.memoryUsage();

    console.log(
      JSON.stringify({
        event: "http_request",
        requestId: id,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        contentLength: res.getHeader("content-length") || null,
        userAgent: req.get("user-agent") || null,
        cfRay: req.get("cf-ray") || null,
        renderRequestId: req.get("x-render-request-id") || null,
        uptimeSeconds: Math.round(process.uptime()),
        memoryRssMb: Math.round(memory.rss / 1024 / 1024),
        memoryHeapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      }),
    );
  });

  next();
}

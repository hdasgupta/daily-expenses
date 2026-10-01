export function notFound(req, res) {
  res.status(404).json({ error: "Route not found" });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  console.error(error);
  if (error?.code === "23505")
    return res.status(409).json({ error: "A value with that name already exists" });
  if (error?.code === "23503") return res.status(409).json({ error: "The record is still in use" });
  if (error?.code === "LIMIT_FILE_SIZE")
    return res.status(413).json({ error: "Uploaded file is too large" });
  res.status(error.statusCode || 500).json({ error: error.message || "Internal server error" });
}

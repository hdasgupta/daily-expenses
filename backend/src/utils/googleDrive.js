export function buildGoogleDriveDownloadUrls(documentId) {
  const id = encodeURIComponent(String(documentId).trim());
  return [
    `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
    `https://drive.google.com/uc?export=download&id=${id}`,
    `https://docs.google.com/document/d/${id}/export?format=pdf`,
  ];
}

export function buildBulkProofUrls({ googleDocsId, contractUrl }) {
  const directUrl = String(contractUrl || "").trim();
  if (directUrl) return [directUrl];
  const id = String(googleDocsId || "").trim();
  if (!id) return [];
  if (/^https?:\/\//i.test(id)) return [id];
  return buildGoogleDriveDownloadUrls(id);
}

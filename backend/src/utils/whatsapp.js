export function normalizeWhatsAppNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const digits = raw.replace(/[^\d]/g, "");

  if (digits.length === 10 && digits.startsWith("0") === false) {
    return `91${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    return `91${digits.slice(1)}`;
  }

  if (digits.length < 8 || digits.length > 15) {
    throw new Error("WhatsApp number must include a valid international country code");
  }

  return digits;
}

export function whatsappChatId(value) {
  const normalized = normalizeWhatsAppNumber(value);
  return normalized ? `${normalized}@c.us` : null;
}

export function displayWhatsAppNumber(value) {
  const normalized = normalizeWhatsAppNumber(value);
  return normalized ? `+${normalized}` : "";
}

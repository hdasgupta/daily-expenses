export function requiredText(value, fieldName) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${fieldName} is required`);
  return result;
}

export function optionalText(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

export function positiveOrZero(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0)
    throw new Error(`${fieldName} must be zero or greater`);
  return number;
}

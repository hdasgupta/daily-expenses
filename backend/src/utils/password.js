export const passwordRules = [
  {
    code: "length",
    label: "At least 8 characters",
    test: (value) => value.length >= 8,
  },
  {
    code: "uppercase",
    label: "At least one capital letter",
    test: (value) => /[A-Z]/.test(value),
  },
  {
    code: "lowercase",
    label: "At least one small letter",
    test: (value) => /[a-z]/.test(value),
  },
  {
    code: "special",
    label: "At least one special character",
    test: (value) => /[^A-Za-z0-9\s]/.test(value),
  },
  {
    code: "digit",
    label: "At least one digit",
    test: (value) => /\d/.test(value),
  },
  { code: "nospace", label: "No spaces", test: (value) => !/\s/.test(value) },
];

export function validatePassword(password, confirmPassword = null) {
  const value = String(password || "");
  const failures = passwordRules.filter((rule) => !rule.test(value));
  if (failures.length) {
    throw new Error(`Password does not meet: ${failures.map((item) => item.label).join(", ")}`);
  }
  if (confirmPassword !== null && value !== String(confirmPassword || "")) {
    throw new Error("Password and confirmed password must match");
  }
}

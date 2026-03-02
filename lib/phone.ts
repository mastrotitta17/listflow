export const sanitizePhoneInput = (value: string, maxLength = 32): string => {
  if (typeof value !== "string") {
    return "";
  }

  const compact = value.replace(/\s+/g, "");
  const digitsOnly = compact.replace(/\D/g, "");
  const hasLeadingPlus = compact.startsWith("+");
  const normalized = hasLeadingPlus ? `+${digitsOnly}` : digitsOnly;

  if (maxLength <= 0) {
    return "";
  }

  return normalized.slice(0, maxLength);
};

export const normalizePhoneForStorage = (value: unknown, maxLength = 32): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = sanitizePhoneInput(value, maxLength);
  if (!normalized || normalized === "+") {
    return null;
  }

  if (!/^\+?\d+$/.test(normalized)) {
    return null;
  }

  return normalized;
};

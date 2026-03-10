const EU_IOSS_COUNTRY_CODES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

export const requiresIossForCountry = (countryCode: string | null | undefined) => {
  const normalized = (countryCode ?? "").trim().toUpperCase();
  return EU_IOSS_COUNTRY_CODES.has(normalized);
};

export const getIossCountryCodes = () => Array.from(EU_IOSS_COUNTRY_CODES);

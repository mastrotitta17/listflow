import { City, Country, State } from "country-state-city";

export type GeoCountryOption = {
  code: string;
  name: string;
};

export type GeoStateOption = {
  code: string;
  name: string;
};

export type GeoCityOption = {
  name: string;
};

const countriesCache: GeoCountryOption[] = Country.getAllCountries()
  .map((country) => ({
    code: country.isoCode,
    name: country.name,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

const statesCache = new Map<string, GeoStateOption[]>();
const citiesCache = new Map<string, GeoCityOption[]>();

const normalizeCountryCode = (value: string) => value.trim().toUpperCase();
const normalizeStateCode = (value: string | null | undefined) => (value ?? "").trim().toUpperCase();

export const getGeoCountries = () => countriesCache;

export const getGeoStates = (countryCode: string) => {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  if (!normalizedCountryCode) {
    return [];
  }

  const cached = statesCache.get(normalizedCountryCode);
  if (cached) {
    return cached;
  }

  const states = State.getStatesOfCountry(normalizedCountryCode)
    .map((state) => ({
      code: state.isoCode,
      name: state.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  statesCache.set(normalizedCountryCode, states);
  return states;
};

export const getGeoCities = (args: { countryCode: string; stateCode?: string | null }) => {
  const normalizedCountryCode = normalizeCountryCode(args.countryCode);
  if (!normalizedCountryCode) {
    return [];
  }

  const normalizedStateCode = normalizeStateCode(args.stateCode);
  const cacheKey = `${normalizedCountryCode}:${normalizedStateCode || "*"}`;
  const cached = citiesCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const cityRows = normalizedStateCode
    ? City.getCitiesOfState(normalizedCountryCode, normalizedStateCode)
    : City.getCitiesOfCountry(normalizedCountryCode);

  const uniqueNames = new Map<string, string>();

  for (const city of cityRows ?? []) {
    const rawName = (city.name ?? "").trim();
    if (!rawName) {
      continue;
    }
    const key = rawName.toLocaleLowerCase("en");
    if (!uniqueNames.has(key)) {
      uniqueNames.set(key, rawName);
    }
  }

  const cities = Array.from(uniqueNames.values())
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
    .map((name) => ({ name }));

  citiesCache.set(cacheKey, cities);
  return cities;
};

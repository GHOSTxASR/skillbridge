// Where the user wants to work, and how well a listing's location fits it.
// Shared by /api/jobs (ranking) and the Jobs page (the picker). No DOM or server APIs.

// Preselected until the user picks another location. Any free-text location works;
// this is only the starting value.
export const DEFAULT_JOB_LOCATION = "Kolkata, India"

export const JOB_LOCATION_SUGGESTIONS = [
  "Kolkata, India",
  "Bengaluru, India",
  "Mumbai, India",
  "Delhi NCR, India",
  "Hyderabad, India",
  "Pune, India",
  "Chennai, India",
  "London, UK",
  "Berlin, Germany",
  "New York, USA",
  "Remote",
] as const

const MAX_LOCATION_LENGTH = 80

// Letters in any script, digits, spaces and the punctuation place names use.
const LOCATION_PATTERN = /^[\p{L}\p{M}\p{N} ,.'()/&-]+$/u

export function sanitizeJobLocation(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (!trimmed || trimmed.length > MAX_LOCATION_LENGTH) return null
  return LOCATION_PATTERN.test(trimmed) ? trimmed : null
}

export type LocationMatch = "city" | "country" | "remote" | "other"

// Ranking weight per match; /api/jobs sorts on this before skill match.
export const LOCATION_SCORE: Record<LocationMatch, number> = {
  city: 100,
  country: 70,
  remote: 40,
  other: 0,
}

type Region = "apac" | "emea" | "americas"

type Country = {
  names: string[]
  region: Region
  // Cities The Muse lists jobs under, in its own spelling ("Bangalore, India").
  museHubs: string[]
}

const COUNTRIES: Record<string, Country> = {
  india: {
    names: ["india", "bharat"],
    region: "apac",
    museHubs: [
      "Bangalore, India",
      "Hyderabad, India",
      "Mumbai, India",
      "Gurgaon, India",
      "Pune, India",
      "Chennai, India",
      "New Delhi, India",
      "Noida, India",
    ],
  },
  uk: {
    names: ["united kingdom", "uk", "england", "scotland", "wales", "great britain", "britain"],
    region: "emea",
    museHubs: ["London, United Kingdom", "Manchester, United Kingdom", "Edinburgh, United Kingdom"],
  },
  germany: {
    names: ["germany", "deutschland"],
    region: "emea",
    museHubs: ["Berlin, Germany", "Munich, Germany", "Hamburg, Germany", "Frankfurt, Germany"],
  },
  france: { names: ["france"], region: "emea", museHubs: ["Paris, France"] },
  switzerland: { names: ["switzerland", "schweiz", "suisse"], region: "emea", museHubs: ["Zurich, Switzerland"] },
  netherlands: { names: ["netherlands", "holland"], region: "emea", museHubs: ["Amsterdam, Netherlands"] },
  ireland: { names: ["ireland"], region: "emea", museHubs: ["Dublin, Ireland"] },
  austria: { names: ["austria", "österreich"], region: "emea", museHubs: [] },
  belgium: { names: ["belgium"], region: "emea", museHubs: [] },
  spain: { names: ["spain", "españa"], region: "emea", museHubs: [] },
  portugal: { names: ["portugal"], region: "emea", museHubs: [] },
  italy: { names: ["italy", "italia"], region: "emea", museHubs: [] },
  poland: { names: ["poland", "polska"], region: "emea", museHubs: [] },
  sweden: { names: ["sweden"], region: "emea", museHubs: [] },
  denmark: { names: ["denmark"], region: "emea", museHubs: [] },
  norway: { names: ["norway"], region: "emea", museHubs: [] },
  finland: { names: ["finland"], region: "emea", museHubs: [] },
  usa: {
    names: ["united states", "usa", "us", "u.s.", "u.s.a."],
    region: "americas",
    museHubs: ["New York, NY", "San Francisco, CA", "Seattle, WA", "Austin, TX", "Boston, MA"],
  },
  canada: { names: ["canada"], region: "americas", museHubs: ["Toronto, Canada", "Vancouver, Canada"] },
  singapore: { names: ["singapore"], region: "apac", museHubs: ["Singapore"] },
  australia: { names: ["australia"], region: "apac", museHubs: ["Sydney, Australia", "Melbourne, Australia"] },
}

type City = {
  names: string[]
  country: keyof typeof COUNTRIES
  muse: string[]
}

const CITIES: Record<string, City> = {
  kolkata: { names: ["kolkata", "calcutta"], country: "india", muse: ["Kolkata, India"] },
  bengaluru: { names: ["bengaluru", "bangalore"], country: "india", muse: ["Bangalore, India"] },
  mumbai: { names: ["mumbai", "bombay", "navi mumbai", "thane"], country: "india", muse: ["Mumbai, India"] },
  delhi: {
    names: ["delhi ncr", "delhi", "new delhi", "ncr", "gurgaon", "gurugram", "noida", "ghaziabad", "faridabad"],
    country: "india",
    muse: ["New Delhi, India", "Gurgaon, India", "Noida, India"],
  },
  hyderabad: { names: ["hyderabad", "secunderabad"], country: "india", muse: ["Hyderabad, India"] },
  pune: { names: ["pune"], country: "india", muse: ["Pune, India"] },
  chennai: { names: ["chennai", "madras"], country: "india", muse: ["Chennai, India"] },
  ahmedabad: { names: ["ahmedabad"], country: "india", muse: ["Ahmedabad, India"] },
  kochi: { names: ["kochi", "cochin"], country: "india", muse: ["Kochi, India"] },
  london: { names: ["london"], country: "uk", muse: ["London, United Kingdom"] },
  manchester: { names: ["manchester"], country: "uk", muse: ["Manchester, United Kingdom"] },
  edinburgh: { names: ["edinburgh"], country: "uk", muse: ["Edinburgh, United Kingdom"] },
  berlin: { names: ["berlin"], country: "germany", muse: ["Berlin, Germany"] },
  munich: { names: ["munich", "münchen", "muenchen"], country: "germany", muse: ["Munich, Germany"] },
  hamburg: { names: ["hamburg"], country: "germany", muse: ["Hamburg, Germany"] },
  frankfurt: { names: ["frankfurt"], country: "germany", muse: ["Frankfurt, Germany"] },
  cologne: { names: ["cologne", "köln", "koeln"], country: "germany", muse: ["Cologne, Germany"] },
  paris: { names: ["paris"], country: "france", muse: ["Paris, France"] },
  zurich: { names: ["zurich", "zürich"], country: "switzerland", muse: ["Zurich, Switzerland"] },
  amsterdam: { names: ["amsterdam"], country: "netherlands", muse: ["Amsterdam, Netherlands"] },
  dublin: { names: ["dublin"], country: "ireland", muse: ["Dublin, Ireland"] },
  "new york": {
    names: ["new york", "new york city", "nyc", "manhattan", "brooklyn"],
    country: "usa",
    muse: ["New York, NY"],
  },
  "san francisco": {
    names: ["san francisco", "bay area"],
    country: "usa",
    muse: ["San Francisco, CA"],
  },
  seattle: { names: ["seattle"], country: "usa", muse: ["Seattle, WA"] },
  austin: { names: ["austin"], country: "usa", muse: ["Austin, TX"] },
  boston: { names: ["boston"], country: "usa", muse: ["Boston, MA"] },
  toronto: { names: ["toronto"], country: "canada", muse: ["Toronto, Canada"] },
  vancouver: { names: ["vancouver"], country: "canada", muse: ["Vancouver, Canada"] },
  singapore: { names: ["singapore"], country: "singapore", muse: ["Singapore"] },
  sydney: { names: ["sydney"], country: "australia", muse: ["Sydney, Australia"] },
  melbourne: { names: ["melbourne"], country: "australia", muse: ["Melbourne, Australia"] },
}

const REGION_TERMS: Record<Region, string[]> = {
  apac: ["apac", "asia", "asia pacific", "asia-pacific"],
  emea: ["emea", "europe", "eu", "european union", "eea"],
  americas: ["americas", "north america", "northern america"],
}

// Remote listings open to anyone.
const ANYWHERE_TERMS = ["worldwide", "anywhere", "global", "remote", "flexible / remote", "flexible", "work from home"]

const REMOTE_ONLY_TERMS = ["remote", "anywhere", "worldwide", "work from home", "wfh"]

export type JobLocationTarget = {
  // What the user asked for, as shown in the UI ("Kolkata, India").
  label: string
  remoteOnly: boolean
  city: string | null
  cityNames: string[]
  country: string | null
  countryNames: string[]
  // Every city name we know in the target country, so "Berlin" (no country) still
  // counts as Germany.
  countryCityNames: string[]
  region: Region | null
  // Locations to request from The Muse: the city itself, and the country's hubs.
  museCityLocations: string[]
  museCountryLocations: string[]
}

function normalizePlace(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}.,/ ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// Whole-word match, so "india" does not match "Indianapolis" and "us" does not match "Busan".
export function mentionsPlace(text: string, name: string): boolean {
  if (!text || !name) return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(text)
}

function findCity(parts: string[]): [string, City] | null {
  for (const part of parts) {
    for (const [key, city] of Object.entries(CITIES)) {
      if (city.names.some((name) => part === name || mentionsPlace(part, name))) return [key, city]
    }
  }
  return null
}

function findCountry(parts: string[]): string | null {
  for (const part of parts) {
    for (const [key, country] of Object.entries(COUNTRIES)) {
      if (country.names.some((name) => part === name || mentionsPlace(part, name))) return key
    }
  }
  return null
}

function titleCase(value: string): string {
  return value.replace(/\p{L}+/gu, (word) => word[0].toUpperCase() + word.slice(1))
}

export function parseJobLocation(label: string): JobLocationTarget {
  const normalized = normalizePlace(label)
  const parts = normalized.split(",").map((part) => part.trim()).filter(Boolean)

  const remoteOnly = REMOTE_ONLY_TERMS.some((term) => normalized === term)

  if (remoteOnly) {
    return {
      label,
      remoteOnly: true,
      city: null,
      cityNames: [],
      country: null,
      countryNames: [],
      countryCityNames: [],
      region: null,
      museCityLocations: ["Flexible / Remote"],
      museCountryLocations: [],
    }
  }

  const knownCity = findCity(parts)
  const countryKey = knownCity?.[1].country ?? findCountry(parts.slice(1).concat(parts.slice(0, 1)))
  const country = countryKey ? COUNTRIES[countryKey] : null

  // A city we do not know is still searchable: take the first part as the city and
  // the last part as the country, as the user typed them.
  const typedCity = parts.length > 1 || !country ? parts[0] ?? null : null
  const cityNames = knownCity ? knownCity[1].names : typedCity ? [typedCity] : []
  const countryNames = country ? country.names : parts.length > 1 ? [parts[parts.length - 1]] : []

  const countryCityNames = countryKey
    ? Object.values(CITIES)
        .filter((city) => city.country === countryKey)
        .flatMap((city) => city.names)
    : []

  const museCityLocations = knownCity
    ? knownCity[1].muse
    : typedCity
      ? [titleCase(label.split(",").map((part) => part.trim()).filter(Boolean).join(", "))]
      : []

  const museCountryLocations = (country?.museHubs ?? []).filter(
    (hub) => !museCityLocations.includes(hub)
  )

  return {
    label,
    remoteOnly: false,
    city: knownCity?.[0] ?? typedCity,
    cityNames,
    country: countryKey ?? (parts.length > 1 ? parts[parts.length - 1] : null),
    countryNames,
    countryCityNames,
    region: country?.region ?? null,
    museCityLocations,
    museCountryLocations,
  }
}

// How a listing's location fits what the user asked for.
export function classifyJobLocation(
  jobLocation: string,
  remote: boolean,
  target: JobLocationTarget
): LocationMatch {
  const text = normalizePlace(jobLocation)

  if (target.remoteOnly) return remote ? "remote" : "other"

  if (target.cityNames.some((name) => mentionsPlace(text, name))) return "city"

  if (
    target.countryNames.some((name) => mentionsPlace(text, name)) ||
    target.countryCityNames.some((name) => mentionsPlace(text, name))
  ) {
    return "country"
  }

  if (remote) {
    // Open to anyone, or to the user's region.
    const stripped = text.replace(/\b(remote|flexible)\b/g, "").replace(/[\s/|,·-]+/g, " ").trim()
    if (!stripped) return "remote"
    if (ANYWHERE_TERMS.some((term) => mentionsPlace(text, term)) && !namesOtherPlace(text, target)) {
      return "remote"
    }
    if (target.region && REGION_TERMS[target.region].some((term) => mentionsPlace(text, term))) {
      return "remote"
    }
  }

  return "other"
}

// True when a remote listing names a specific country or city outside the target,
// such as "Worldwide (USA only)" or "Remote · New York, NY".
function namesOtherPlace(text: string, target: JobLocationTarget): boolean {
  const otherCountries = Object.entries(COUNTRIES)
    .filter(([key]) => key !== target.country)
    .flatMap(([, country]) => country.names)
  const otherCities = Object.values(CITIES)
    .filter((city) => city.country !== target.country)
    .flatMap((city) => city.names)
  return [...otherCountries, ...otherCities].some((name) => mentionsPlace(text, name))
}

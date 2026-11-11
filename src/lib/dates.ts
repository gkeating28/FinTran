/** The region a date is shown for: a language tag such as en-IE, and a time zone for dates that carry a time. */
export type Region = { locale: string; timeZone: string };

/** Used on the server and until the browser has said what it prefers. */
export const DEFAULT_REGION: Region = { locale: "en-IE", timeZone: "Europe/Dublin" };

function formatter(locale: string, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat(DEFAULT_REGION.locale, options);
  }
}

/**
 * A calendar date such as 2026-10-18, shown as 18 Oct 2026. The parts are the same everywhere and the
 * region decides their order and wording, so en-US reads Oct 18, 2026. A date has no time zone, so it
 * never shifts by a day. Anything that is not a date is returned as it came.
 */
export function formatDate(value: string | null | undefined, region: Region = DEFAULT_REGION) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return value;
  return formatter(region.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

/** A moment such as 2026-10-18T09:05:00Z, shown as 18 Oct 2026, 10:05 in the region's time zone. */
export function formatDateTime(value: string | null | undefined, region: Region = DEFAULT_REGION) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatter(region.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: region.timeZone,
  }).format(date);
}

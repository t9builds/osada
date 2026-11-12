/** Game weeks run Monday 00:00 to Sunday 23:59 in the workspace's timezone; a week is keyed by its Monday's date. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function weekKey(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const local = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")));
  const monday = new Date(local - WEEKDAYS.indexOf(get("weekday")) * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, formatDateTime } from "./dates";

test("a date is day, short month and year, in the region's order", () => {
  assert.equal(formatDate("2026-10-18"), "18 Oct 2026");
  assert.equal(formatDate("2026-10-18", { locale: "en-US", timeZone: "America/New_York" }), "Oct 18, 2026");
  assert.equal(formatDate("2026-10-18", { locale: "de-DE", timeZone: "Europe/Berlin" }), "18. Okt. 2026");
});

test("a date does not move by a day in a time zone behind UTC", () => {
  assert.equal(formatDate("2026-01-01", { locale: "en-IE", timeZone: "America/Los_Angeles" }), "1 Jan 2026");
});

test("blank and unreadable values are left alone", () => {
  assert.equal(formatDate(""), "");
  assert.equal(formatDate(null), "");
  assert.equal(formatDate("soon"), "soon");
});

test("a moment is shown in the region's time zone", () => {
  assert.equal(formatDateTime("2026-10-18T09:05:00Z"), "18 Oct 2026, 10:05");
  assert.equal(formatDateTime("2026-10-18T09:05:00Z", { locale: "en-IE", timeZone: "UTC" }), "18 Oct 2026, 09:05");
});

test("an unknown locale falls back to the default", () => {
  assert.equal(formatDate("2026-10-18", { locale: "not a locale", timeZone: "UTC" }), "18 Oct 2026");
});

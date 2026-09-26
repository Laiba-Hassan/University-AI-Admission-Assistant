import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isWithinWorkingHours } from "../src/working-hours.js";

const HOURS = { tz: "Asia/Karachi", mon_fri: "09:00-17:00", sat: "09:00-13:00", sun: null };

describe("isWithinWorkingHours", () => {
  it("is open during a weekday within the range", () => {
    // 2026-09-21 is a Monday; 10:00 in Asia/Karachi (UTC+5) is 05:00 UTC.
    assert.equal(isWithinWorkingHours(HOURS, new Date("2026-09-21T05:00:00Z")), true);
  });
  it("is closed before opening and after closing on a weekday", () => {
    assert.equal(isWithinWorkingHours(HOURS, new Date("2026-09-21T02:00:00Z")), false); // 07:00 PKT
    assert.equal(isWithinWorkingHours(HOURS, new Date("2026-09-21T13:00:00Z")), false); // 18:00 PKT
  });
  it("uses the day-specific range on Saturday and treats a null day as closed", () => {
    assert.equal(isWithinWorkingHours(HOURS, new Date("2026-09-26T06:00:00Z")), true); // Sat 11:00 PKT
    assert.equal(isWithinWorkingHours(HOURS, new Date("2026-09-27T06:00:00Z")), false); // Sunday, sun: null
  });
  it("returns undefined (unknown) rather than a guess when data is missing or malformed", () => {
    assert.equal(isWithinWorkingHours(undefined), undefined);
    assert.equal(isWithinWorkingHours({}), undefined);
    assert.equal(isWithinWorkingHours({ tz: "Not/AZone", mon_fri: "09:00-17:00" }), undefined);
    // Fixed to a Monday (see the first test above) so this doesn't depend on which weekday CI happens to run on --
    // otherwise a real Sat/Sun "now" hits the "explicitly closed that day" branch before the regex is ever checked.
    assert.equal(isWithinWorkingHours({ tz: "Asia/Karachi", mon_fri: "9am-5pm" }, new Date("2026-09-21T05:00:00Z")), undefined);
  });
});

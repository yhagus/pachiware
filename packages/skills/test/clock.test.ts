import { describe, expect, test } from "bun:test";
import { describeTime, hhmm, isoInZone, offsetText, wallClock, zoneOffset, zonedTime } from "../src/clock";

const at = Date.parse("2026-03-06T02:30:00Z");

describe("zone helpers", () => {
  test("hhmm and offsetText pad to two digits", () => {
    expect(hhmm(9, 5)).toBe("09:05");
    expect(hhmm(23, 59)).toBe("23:59");
    expect(offsetText(420)).toBe("+07:00");
    expect(offsetText(-330)).toBe("-05:30");
    expect(offsetText(0)).toBe("+00:00");
  });

  test("wallClock, zoneOffset and isoInZone agree on what a wall clock shows", () => {
    expect(wallClock("Asia/Jakarta", at)).toEqual({ year: 2026, month: 3, day: 6, hour: 9, minute: 30, second: 0 });
    expect(zoneOffset("Asia/Jakarta", at)).toBe(420);
    expect(zoneOffset("America/New_York", at)).toBe(-300);
    expect(isoInZone("Asia/Jakarta", at)).toBe("2026-03-06T09:30:00+07:00");
    expect(isoInZone("America/New_York", at)).toBe("2026-03-05T21:30:00-05:00");
    expect(describeTime("Asia/Jakarta", at)).toBe("Friday, 6 March 2026, 09:30 Asia/Jakarta (UTC+07:00)");
  });

  test("zonedTime reads a wall-clock string in a zone and rejects times that do not exist", () => {
    expect(zonedTime("Asia/Jakarta", "2026-03-06T09:30")).toBe(at);
    expect(zonedTime("Asia/Jakarta", "2026-03-06T09:30:00")).toBe(at);
    expect(zonedTime("UTC", "2026-02-30T00:00")).toBeNull();
    expect(zonedTime("UTC", "2026-03-06T24:00")).toBeNull();
    expect(zonedTime("UTC", "6 March")).toBeNull();
    // 02:30 on the US spring-forward day is skipped; it is read with the offset after the change (02:30-04:00).
    expect(zonedTime("America/New_York", "2026-03-08T02:30")).toBe(Date.parse("2026-03-08T06:30:00Z"));
  });
});

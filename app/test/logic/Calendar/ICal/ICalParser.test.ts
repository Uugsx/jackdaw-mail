import { expect, test } from "vitest";
import { ICalEntry } from "../../../../logic/Calendar/ICal/ICalParser";

test("Parses quoted parameters", () => {
  let entry = new ICalEntry('ATTENDEE;CN="Doe; Jane";PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:jane@example.com');
  expect(entry.name).toBe("attendee");
  expect(entry.properties.cn).toBe("Doe; Jane");
  expect(entry.properties.partstat).toBe("NEEDS-ACTION");
  expect(entry.properties.rsvp).toBe("TRUE");
  expect(entry.value).toBe("mailto:jane@example.com");
});

test("Parses escaped separators in values", () => {
  let entry = new ICalEntry("CATEGORIES:A,B;C\\;D");
  expect(entry.value).toBe("A,B;C;D");
  expect(entry.values).toEqual(["A,B", "C;D"]);
});

test("Keeps a backslash that does not escape the parameter end", () => {
  let entry = new ICalEntry("X-FILE;NAME=a\\:value");
  expect(entry.properties.name).toBe("a\\");
  expect(entry.value).toBe("value");
});

test("Parameter made of backslashes does not hang the parser", () => {
  let start = performance.now();
  let entry = new ICalEntry("X;A=" + "\\".repeat(5000));
  new ICalEntry("X:" + "\\".repeat(5000) + String.fromCharCode(0x2028));
  expect(performance.now() - start).toBeLessThan(1000);
  expect(entry.properties.a).toBeUndefined();
});

import { expect, test } from "vitest";
import type { EMail } from "../../../logic/Mail/EMail";
import { markMessagesRead, uniqueMessagesByIdentity } from "../../../frontend/Mail/mailReadActions";

function fake(fields: Partial<EMail>): EMail {
  return { dbID: null, pID: null, id: null, isRead: false, ...fields } as unknown as EMail;
}

test("dedupes like the pairwise comparison: dbID first, then pID, then id", () => {
  let a = fake({ dbID: 1, pID: "x" });
  let sameDB = fake({ dbID: 1, pID: "y" });
  let otherDBSamePID = fake({ dbID: 2, pID: "x" });
  let noDBSamePID = fake({ pID: "x" });
  let byID = fake({ id: "m1" });
  let byIDAgain = fake({ id: "m1" });
  let collision = fake({ pID: 1 });
  expect(uniqueMessagesByIdentity([a, sameDB, otherDBSamePID, noDBSamePID, a, byID, byIDAgain, collision]))
    .toEqual([a, otherDBSamePID, byID, collision]);
});

test("marks 20 000 messages read without pairwise comparison", async () => {
  let folder = { markMessagesRead: async () => undefined };
  let messages = Array.from({ length: 20_000 }, (_, i) => fake({ dbID: i, folder } as unknown as Partial<EMail>));
  let started = performance.now();
  await markMessagesRead(messages, true);
  expect(performance.now() - started).toBeLessThan(2000);
  expect(messages.every(message => message.isRead)).toBe(true);
});

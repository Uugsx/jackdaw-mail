import { expect, test } from "vitest";
import BaseProtocol from "../../../lib/jpc/obj.js";

/** Кодирует и разбирает значение так же, как JPC при вызове на другой стороне. */
async function roundTrip(value: any): Promise<any> {
  let protocol = new (BaseProtocol as any)();
  let encoded = JSON.parse(JSON.stringify(protocol.mapOutgoingObjects(value)));
  return await protocol.mapIncomingObjects(encoded);
}

test("один и тот же объект в нескольких элементах массива доходит везде", async () => {
  // Так пакет SQL ссылается на id вставленного письма из многих шагов:
  // ссылка лежит на разной глубине, а элементы массива разбирались параллельно.
  let rowID = { batchRef: 0, field: "lastInsertRowid" };
  let steps = [
    { query: { sourceParts: ["INSERT"], parameters: ["a", "b"] } },
    { query: { sourceParts: ["UPDATE", "WHERE id ="], parameters: [{ nested: [1, 2, 3] }, rowID] } },
    { query: { sourceParts: ["INSERT tag"], parameters: [rowID, "tag"] } },
    { query: { sourceParts: ["INSERT rel"], parameters: [rowID, 5, 6] } },
  ];
  let decoded = await roundTrip(steps);
  expect(decoded[1].query.parameters[1]).toEqual(rowID);
  expect(decoded[2].query.parameters[0]).toEqual(rowID);
  expect(decoded[3].query.parameters[0]).toEqual(rowID);
});

test("объект, на который ссылаются раньше, чем разобраны его поля", async () => {
  let shared = { deep: { deeper: { value: 42 } } };
  let decoded = await roundTrip([[[[shared]]], shared, [shared]]);
  expect(decoded[0][0][0][0]).toEqual(shared);
  expect(decoded[1]).toEqual(shared);
  expect(decoded[2][0]).toEqual(shared);
});

test("общий объект остаётся одним объектом после разбора", async () => {
  let shared = { x: 1 };
  let decoded = await roundTrip({ a: shared, b: [shared, shared] });
  expect(decoded.a).toBe(decoded.b[0]);
  expect(decoded.b[0]).toBe(decoded.b[1]);
});

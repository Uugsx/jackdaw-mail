import { isNetworkError } from "../../../logic/util/netUtil";
import { expect, test } from "vitest";

test("DNS-сбой Chromium считается сетевой ошибкой", () => {
  expect(isNetworkError(new Error("net::ERR_NAME_NOT_RESOLVED"))).toBe(true);
  expect(isNetworkError(new Error("net::ERR_ADDRESS_UNREACHABLE"))).toBe(true);
  expect(isNetworkError(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe(true);
});

test("обычная ошибка не сетевая", () => {
  expect(isNetworkError(new Error("HTTP 401"))).toBe(false);
});

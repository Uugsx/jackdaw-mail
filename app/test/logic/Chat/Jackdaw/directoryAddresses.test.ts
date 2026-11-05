// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { describe, expect, test } from "vitest";
import { ArrayColl } from "svelte-collections";
import { ContactEntry, Person } from "../../../../logic/Abstract/Person";
import { findDirectoryAddresses } from "../../../../logic/Chat/Jackdaw/directoryAddresses";

function person(...emails: string[]): Person {
  let result = new Person();
  result.emailAddresses.replaceAll(emails.map(email => new ContactEntry(email, "work", "mailto")));
  return result;
}

/** Каталог организации: по запросу отдаёт заранее заданных людей */
function directory(found: Person[], fail = false) {
  return {
    async quickSearchAsync(_term: string, results: ArrayColl<Person>) {
      if (fail) {
        throw new Error("directory is down");
      }
      results.addAll(found);
    },
  } as any;
}

describe("адреса из каталога организации", () => {
  test("псевдоним → остальные адреса того же человека", async () => {
    let found = await findDirectoryAddresses("Nikita.Levchenko@example.com",
      [directory([person("nlevchenko0181@example.com", "nikita.levchenko@example.com")])]);
    expect(found).toEqual(["nlevchenko0181@example.com"]);
  });

  test("каталог вернул только основной адрес (OWA ResolveNames) — берём его", async () => {
    expect(await findDirectoryAddresses("nikita.levchenko@example.com",
      [directory([person("nlevchenko0181@example.com")])])).toEqual(["nlevchenko0181@example.com"]);
  });

  test("несколько разных людей — ничего не выбираем", async () => {
    expect(await findDirectoryAddresses("nikita@example.com",
      [directory([person("n1@example.com"), person("n2@example.com")])])).toEqual([]);
  });

  test("тот же человек из двух каталогов считается одним; сбой каталога не мешает", async () => {
    expect(await findDirectoryAddresses("alias@example.com", [
      directory([], true),
      directory([person("box@example.com", "alias@example.com")]),
      directory([person("alias@example.com", "box@example.com")]),
    ])).toEqual(["box@example.com"]);
  });

  test("без каталогов и с плохим адресом — пусто", async () => {
    expect(await findDirectoryAddresses("alias@example.com", [])).toEqual([]);
    expect(await findDirectoryAddresses("not an email", [directory([person("box@example.com")])])).toEqual([]);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const kRoot = join(__dirname, "../..");
const kDirs = ["frontend", "logic"];
// Директивы собраны из частей: препроцессор сборки обрабатывает и этот файл
const kHash = "#";
const kDirective = new RegExp(`//\\s*${kHash}(if|else|endif)\\b(.*)$`);

function sourceFiles(dir: string): string[] {
  let files: string[] = [];
  for (let name of readdirSync(dir)) {
    let path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (/\.(svelte|ts)$/.test(name)) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Импорты внутри условного блока `[!PRODUCTION]` или `[DEV]`, которые нужны и вне блока.
 * Препроцессор вырезает такой блок в рабочей сборке: в dev и тестах всё работает,
 * а у пользователя — «onDestroy is not defined» при открытии контекстного меню письма.
 */
function devOnlyImportsUsedOutside(source: string): string[] {
  let lines = source.split("\n");
  let stack: boolean[] = [];
  let devImports: string[] = [];
  let outside: string[] = [];
  for (let line of lines) {
    let directive = line.match(kDirective);
    if (directive) {
      if (directive[1] == "if") {
        stack.push(/PRODUCTION|\bDEV\b/.test(directive[2]));
      } else if (directive[1] == "else") {
        // Ветка «иначе» у dev-блока — как раз рабочая сборка
        stack[stack.length - 1] = false;
      } else {
        stack.pop();
      }
      continue;
    }
    let inDevBlock = stack.some(Boolean);
    let named = line.match(/^\s*import\s+\{([^}]*)\}\s+from/);
    if (inDevBlock && named) {
      devImports.push(...named[1].split(",")
        .map(name => name.trim())
        .filter(name => name && !name.startsWith("type "))
        .map(name => name.split(/\s+as\s+/).pop()!));
    } else if (!inDevBlock) {
      outside.push(line);
    }
  }
  let rest = outside.join("\n");
  return devImports.filter(name => new RegExp(`\\b${name}\\b`).test(rest));
}

describe("импорты только для разработки", () => {
  it("не используются вне блока, который вырезается в рабочей сборке", () => {
    let problems: string[] = [];
    for (let dir of kDirs) {
      for (let file of sourceFiles(join(kRoot, dir))) {
        for (let name of devOnlyImportsUsedOutside(readFileSync(file, "utf8"))) {
          problems.push(`${relative(kRoot, file)}: ${name}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("находит импорт, который нужен вне dev-блока", () => {
    let source = [
      `// ${kHash}if [!PRODUCTION]`,
      'import { onDestroy, tick } from "svelte";',
      `// ${kHash}endif`,
      "onDestroy(() => {});",
    ].join("\n");
    expect(devOnlyImportsUsedOutside(source)).toEqual(["onDestroy"]);
  });
});

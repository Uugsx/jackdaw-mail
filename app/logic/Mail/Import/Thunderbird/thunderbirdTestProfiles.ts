import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { localDirectory } from "../../../../test/logic/util/backend.test";

/** Есть ли на этом компьютере профили Thunderbird — тот же путь, что `ThunderbirdProfile.baseDir()` */
export function hasThunderbirdProfiles(): boolean {
  let platform = os.platform();
  let dir = localDirectory(platform == "win32" ? "appData" : "home");
  let subdir =
    platform == "darwin" ? "Library/Thunderbird" :
      platform == "win32" ? "Thunderbird" :
        ".thunderbird";
  return existsSync(path.join(dir, subdir));
}

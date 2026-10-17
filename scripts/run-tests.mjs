import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "pending") continue;
      out.push(...collect(p));
    } else if (name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const files = collect("test");
const r = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);

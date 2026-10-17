import { cpSync, rmSync } from "node:fs";

rmSync("api/_dist", { recursive: true, force: true });
cpSync("dist", "api/_dist", { recursive: true });

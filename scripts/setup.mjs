#!/usr/bin/env node
// Creates .env from .env.example with freshly generated local secrets.
// Never overwrites an existing .env. Needs no external credentials.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

if (existsSync(".env")) {
  console.log(".env already exists — leaving it untouched.");
} else {
  const secret = () => randomBytes(32).toString("base64");
  const text = readFileSync(".env.example", "utf8")
    .replace('JOIN_CODE_HASH_KEY=""', `JOIN_CODE_HASH_KEY="${secret()}"`)
    .replace('CLEANUP_TOKEN=""', `CLEANUP_TOKEN="${randomBytes(32).toString("hex")}"`);
  writeFileSync(".env", text, { mode: 0o600 });
  console.log("Wrote .env with generated JOIN_CODE_HASH_KEY and CLEANUP_TOKEN.");
}
mkdirSync("storage/uploads", { recursive: true });
console.log("Private upload directory: storage/uploads (outside public/).");

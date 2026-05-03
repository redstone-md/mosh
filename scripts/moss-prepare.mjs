#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const TARGET_DIR = path.resolve("src-tauri", "moss-runtime");
const MOSS_DIR = path.resolve("..", "moss");
const OUTPUT_NAME = process.platform === "win32" ? "moss.dll" : process.platform === "darwin" ? "libmoss.dylib" : "libmoss.so";
const OUTPUT_PATH = path.join(TARGET_DIR, OUTPUT_NAME);

async function main() {
  await ensureMossCheckout();
  await mkdir(TARGET_DIR, { recursive: true });

  const result = spawnSync(
    "go",
    ["build", "-buildmode=c-shared", "-o", OUTPUT_PATH, "./cmd/moss-ffi"],
    { cwd: MOSS_DIR, stdio: "inherit" },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  await removeGeneratedHeader();
  console.log(`moss.runtime=${OUTPUT_PATH}`);
}

async function removeGeneratedHeader() {
  const headerName = process.platform === "win32" ? "moss.h" : "libmoss.h";
  await rm(path.join(TARGET_DIR, headerName), { force: true });
}

async function ensureMossCheckout() {
  try {
    await stat(path.join(MOSS_DIR, "cmd", "moss-ffi"));
  } catch {
    throw new Error(`Moss checkout not found at ${MOSS_DIR}`);
  }
}

await main();

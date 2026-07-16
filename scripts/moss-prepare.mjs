#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const TARGET_DIR = path.resolve("src-tauri", "moss-runtime");
const MOSS_DIR = path.resolve("moss");
const OUTPUT_NAME = process.platform === "win32" ? "moss.dll" : process.platform === "darwin" ? "libmoss.dylib" : "libmoss.so";
const OUTPUT_PATH = path.join(TARGET_DIR, OUTPUT_NAME);

async function main() {
  await ensureMossCheckout();
  await mkdir(TARGET_DIR, { recursive: true });

  // Pin the Go toolchain to 1.25.x. Go 1.26.1's Windows runtime has a regression
  // that corrupts memory (0xc0000005) under the heavy concurrent UDP the DHT
  // drives, crashing the client after minutes; 1.25 is verified stable (13 min /
  // 259 msgs, DHT on, 0% loss). GOTOOLCHAIN forces it regardless of the builder's
  // local Go, since the go.mod `toolchain` line is only a minimum.
  const result = spawnSync(
    "go",
    ["build", "-buildmode=c-shared", "-o", OUTPUT_PATH, "./cmd/moss-ffi"],
    { cwd: MOSS_DIR, stdio: "inherit", env: { ...process.env, GOTOOLCHAIN: "go1.25.9" } },
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

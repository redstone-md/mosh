#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

import {
  fetchLatestReleaseVersion,
  readMossConfig,
  resolveMossVersion,
  writePinnedVersion,
} from "../src/features/private-dm/moss-release/moss-release-config.ts";

const args = process.argv.slice(2);
const config = await readMossConfig((path) => readFile(path, "utf8"));
const result = await resolveMossVersion(args, config, fetchLatestReleaseVersion);

if (result.changed) {
  await writeFile("moss.config.json", writePinnedVersion(config, result.version));
}

console.log(`moss.version=${result.version}`);

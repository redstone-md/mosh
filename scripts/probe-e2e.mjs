#!/usr/bin/env node
// Runs a real two-ended DM between this machine and a remote host, and prints
// one merged timeline. The remote end is driven over SSH, so a full round trip
// costs one command instead of two humans with screenshots.
//
//   node scripts/probe-e2e.mjs --host root@94.130.74.148
//
// Exit code is the verdict: 0 when the message was delivered, 1 otherwise.
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REMOTE_BIN = "/usr/local/bin/mosh-probe";
const LOCAL_BIN = path.resolve(
  "mosh-probe",
  "target",
  "release",
  process.platform === "win32" ? "mosh-probe.exe" : "mosh-probe",
);

function arg(name, fallback = null) {
  const hit = process.argv.indexOf(`--${name}`);
  return hit === -1 ? fallback : process.argv[hit + 1];
}

const HOST = arg("host");
const TIMEOUT = arg("timeout", "180");
const BIND = arg("bind-interface");
const MESSAGE = arg("message", "probe ping");

if (!HOST) {
  console.error("usage: probe-e2e.mjs --host user@host [--timeout 180] [--bind-interface NAME]");
  process.exit(2);
}

const events = [];

/// Adds one complete JSONL line to the merged timeline. `run` has already
/// reassembled chunk boundaries, so anything unparseable here is a real
/// anomaly and gets surfaced rather than dropped.
function collect(source, line) {
  const text = line.trim();
  if (!text.startsWith("{")) return;
  try {
    events.push({ source, ...JSON.parse(text) });
  } catch (error) {
    process.stderr.write(`[${source}] unparseable line (${error.message}): ${text.slice(0, 160)}\n`);
  }
}

function run(command, args, source, onEvent) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let pending = "";
  child.stdout.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      collect(source, line);
      if (onEvent) onEvent(events.at(-1));
    }
  });
  child.stderr.on("data", (chunk) => process.stderr.write(`[${source}] ${chunk}`));
  return child;
}

/** Resolves once the remote prints its invite, or rejects if it dies first. */
function waitForInvite(remote) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("remote never emitted an invite")), 60_000);
    const check = setInterval(() => {
      const hit = events.find((e) => e.kind === "invite");
      if (hit) {
        clearInterval(check);
        clearTimeout(timer);
        resolve(hit.data.invite_uri);
      } else if (remote.exitCode !== null) {
        clearInterval(check);
        clearTimeout(timer);
        reject(new Error(`remote exited early (${remote.exitCode})`));
      }
    }, 200);
  });
}

function describe(label, snap) {
  if (!snap) return `${label}: no snapshot`;
  const m = snap.data.mesh ?? {};
  return [
    `${label}: state=${snap.data.state} path=${snap.data.path}`,
    `nat=${m.nat_type} advertised=${m.advertised_addr}`,
    `peers=${m.peer_count} relay_capable=${m.relay_capable_peer_count} known=${m.known_peer_count}`,
  ].join("  ");
}

async function report(localCode) {
  events.sort((a, b) => a.ts - b.ts);
  await writeFile("probe-timeline.jsonl", events.map((e) => JSON.stringify(e)).join("\n"));

  const flags = new Set(
    events.filter((e) => e.kind === "verdict").flatMap((v) => v.data.flags ?? []),
  );
  const last = (source) =>
    [...events].reverse().find((e) => e.source === source && e.kind === "snapshot");

  console.error("");
  console.error(describe("local ", last("local")));
  console.error(describe("remote", last("remote")));
  if (flags.size) console.error(`flags: ${[...flags].join(", ")}`);
  console.error(`timeline: probe-timeline.jsonl (${events.length} events)`);
  console.error(localCode === 0 ? "VERDICT: delivered" : "VERDICT: failed");
}

async function main() {
  const bindArgs = BIND ? ["--bind-interface", BIND] : [];
  const listenCmd = [REMOTE_BIN, "listen", "--timeout-secs", TIMEOUT].join(" ");
  const remote = run("ssh", ["-o", "BatchMode=yes", HOST, listenCmd], "remote");

  const invite = await waitForInvite(remote);
  console.error("[runner] invite received, dialing locally");

  const dialArgs = ["dial", "--invite", invite, "--message", MESSAGE];
  dialArgs.push("--timeout-secs", TIMEOUT, ...bindArgs);
  const local = run(LOCAL_BIN, dialArgs, "local");

  const localCode = await new Promise((resolve) => local.on("close", resolve));
  remote.kill();
  // If ssh already exited, "close" has fired and will never fire again —
  // subscribing unconditionally would hang the runner forever.
  await new Promise((resolve) => {
    if (remote.exitCode !== null || remote.signalCode !== null) resolve();
    else remote.on("close", resolve);
  });

  await report(localCode);
  process.exit(localCode === 0 ? 0 : 1);
}

await main();

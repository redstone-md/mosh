#!/usr/bin/env node
// Runs a real two-ended DM between this machine and a remote host, and prints
// one merged timeline. The remote end is driven over SSH, so a full round trip
// costs one command instead of two humans with screenshots.
//
//   node scripts/probe-e2e.mjs --host <user>@<relay-host>
//
// Exit code is the verdict: 0 when the message was delivered, 1 otherwise.
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_REMOTE_BIN = "/usr/local/bin/mosh-probe";

// Everything the overlay exists for only matters between two hosts that cannot
// be dialed. A public relay on one end is the easy case and hides it, so the
// remote half can be wrapped in anything that ends up invoking the probe —
// notably a container on the default bridge, which is a real NAT rather than a
// simulated one:
//
//   --remote-bin "docker run --rm -v /usr/local/bin:/opt/probe:ro \
//                 debian:bookworm-slim /opt/probe/mosh-probe"
const REMOTE_BIN = arg("remote-bin", DEFAULT_REMOTE_BIN);
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
// More than one means the real test: N conversations open at the same time from
// a single local process, against N independent remote counterparts.
const SESSIONS = Number(arg("sessions", "1"));

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

/** Resolves once the given remote source prints its invite, or rejects if it dies first. */
function waitForInvite(remote, source = "remote") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${source} never emitted an invite`)), 60_000);
    const check = setInterval(() => {
      const hit = events.find((e) => e.source === source && e.kind === "invite");
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

/** Resolves once the remote has printed `count` invites, or rejects if it dies. */
function waitForInvites(remote, count) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`remote emitted fewer than ${count} invites`)),
      90_000,
    );
    const check = setInterval(() => {
      const hits = events.filter((e) => e.source === "remote" && e.kind === "invite");
      if (hits.length >= count) {
        clearInterval(check);
        clearTimeout(timer);
        resolve(hits.slice(0, count).map((hit) => hit.data.invite_uri));
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
  // Multi-session runs label each counterpart separately, so there is no single
  // "remote" to print — report every one of them instead of nothing.
  const remoteSources = [...new Set(events.map((e) => e.source))]
    .filter((source) => source.startsWith("remote"))
    .sort();
  for (const source of remoteSources) console.error(describe(source, last(source)));
  if (flags.size) console.error(`flags: ${[...flags].join(", ")}`);
  console.error(`timeline: probe-timeline.jsonl (${events.length} events)`);
  console.error(localCode === 0 ? "VERDICT: delivered" : "VERDICT: failed");
}

/// Several conversations at once, all from ONE local process — the shape the
/// desktop app has and a single dial does not. Each remote `listen` is its own
/// process and therefore its own counterpart, so N of them stand in for N
/// different people without needing N people.
async function runMany(sessions, bindArgs) {
  // ONE remote process serving every conversation, not one per conversation.
  // N processes on a single host would put N nodes behind one address — the
  // exact shape this work removed — so the far end would be reproducing the
  // defect the run is trying to measure.
  const listenCmd = [
    REMOTE_BIN,
    "listen-many",
    "--sessions",
    String(sessions),
    "--timeout-secs",
    TIMEOUT,
  ].join(" ");
  const remote = run("ssh", ["-o", "BatchMode=yes", HOST, listenCmd], "remote");
  const remotes = [remote];
  const invites = await waitForInvites(remote, sessions);
  console.error(`[runner] ${invites.length} invites received, dialing all from one process`);

  const dialArgs = ["dial-many"];
  for (const invite of invites) dialArgs.push("--invite", invite);
  dialArgs.push("--message", MESSAGE, "--timeout-secs", TIMEOUT, ...bindArgs);
  const local = run(LOCAL_BIN, dialArgs, "local");

  const localCode = await new Promise((resolve) => local.on("close", resolve));
  for (const remote of remotes) remote.kill();
  await Promise.all(
    remotes.map(
      (remote) =>
        new Promise((resolve) => {
          if (remote.exitCode !== null || remote.signalCode !== null) resolve();
          else remote.on("close", resolve);
        }),
    ),
  );
  return localCode;
}

/** One conversation, the original shape. */
async function runSingle(bindArgs) {
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

async function main() {
  const bindArgs = BIND ? ["--bind-interface", BIND] : [];
  if (SESSIONS <= 1) {
    await runSingle(bindArgs);
    return;
  }

  const localCode = await runMany(SESSIONS, bindArgs);
  for (const topology of events.filter((e) => e.kind === "topology")) {
    console.error(
      `topology[${topology.source}]: ${topology.data.sessions} sessions on ` +
        `${topology.data.distinct_nodes} node(s), ports ${JSON.stringify(topology.data.listen_ports)}`,
    );
  }
  await report(localCode);
  process.exit(localCode === 0 ? 0 : 1);
}

await main();

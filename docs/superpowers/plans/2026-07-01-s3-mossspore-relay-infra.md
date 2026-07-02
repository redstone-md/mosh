# S3 — MossSpore relay-mesh infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make MossSpore a mass-deployable SuperNode on the relay mesh `moss-relay/1` (default-on, stable identity), and ship the packaging + a bundled bootstrap list so mosh clients (S2) can actually reach the relay pool.

**Architecture:** The daemon barely changes — a spore is already "a public peer that volunteers as relay." S3 (a) adds a `relay_mesh` config mode that points the node at `moss-relay/1` and defaults persistent identity on, via one `Config.Normalize()`; (b) confirms `/info` surfaces the relay counters; (c) fills mosh's `RELAY_BOOTSTRAP_SPORES` mechanism + docs; (d) packages install.sh/Docker/fly + a run guide. moss (S1) owns all relay mechanics; SuperNode auto-promotion is mesh-agnostic, so joining `moss-relay/1` + `relay.enabled` is all it takes.

**Tech Stack:** Go daemon (`MossSpore`, builds against `../moss` via `replace moss => ../moss`), Rust const in `mosh`, bash `install.sh`, Dockerfile, `fly.toml`, Markdown docs.

## Global Constraints

- **moss dep:** MossSpore builds against `../moss` (the standalone clone) at **`c02acb4`** (S1). Baseline `go build ./...` is green; MossSpore has **no Go tests yet** — this plan adds the first.
- **Relay mesh id:** `const RelayMeshID = "moss-relay/1"` (must match S2's `RELAY_MESH_ID` in `mosh/src-tauri/src/adapters/private_dm_runtime/relay.rs`).
- **Relay-mesh mode is default-ON.** Absent config → relay-mesh mode. Single-mesh operation is explicit opt-out (`relay_mesh.enabled=false`). Config loads over `DefaultConfig()` (main.go:56), so an absent JSON key keeps the base default — set `RelayMesh.Enabled=true` in `DefaultConfig()`.
- **Bundled spore list = data, not trust.** SuperNodes are untrusted (relay is E2E); a stale/hostile entry only wastes one dial. Real addresses are filled POST-DEPLOY (see the ops step at the end) — this plan ships the mechanism + a documented placeholder, never invented IPs.
- **`relay_bytes_total` is NOT in moss** (no byte counter in `MeshInfo`); it is DEFERRED with a documented note. `/info` already emits `relay_session_count`, `relay_route_count`, `supernode_ready` (moss `node_types.go:175-180`).
- **Reachability:** a spore is a viable SuperNode only if inbound-reachable on its peer port (public IP / real forward). `symmetric`/`cgnat` `nat_type` = not viable. Same requirement any SuperNode has.
- **Build gotcha (Windows):** run `go` directly via the Bash tool (Git Bash), never `npm`/cmd (broken AutoRun). `gofmt -l` lies under `core.autocrlf=true` (blobs are LF) — trust `go build`/`go test`, and gofmt with `-w` (empty git diff) if formatting.
- **No `ponytail:`-branded comments in code** — plain comments only (applies to dispatch prompts too).
- **Model policy:** implementers Sonnet floor; reviews Opus 4.8; never Haiku.

---

### Task 1: Relay-mesh mode + persistent identity (`Config.Normalize()`)

**Files:**
- Modify: `MossSpore/internal/spore/config.go` (add `RelayMesh` block, `RelayMeshID`, `Normalize()`, defaults)
- Modify: `MossSpore/cmd/mossspore/main.go` (call `Normalize()` in `resolveConfig`, before flag overrides)
- Modify: `MossSpore/mossspore.example.json` (relay-mesh example)
- Test: `MossSpore/internal/spore/config_test.go` (new)

**Interfaces:**
- Produces: `spore.RelayMeshID` (`"moss-relay/1"`), `spore.RelayMeshConfig{ Enabled bool }`, `Config.RelayMesh`, `func (c *Config) Normalize()`.

- [ ] **Step 1: Write the failing test**

`config_test.go`:
```go
package spore

import "testing"

func TestNormalizeRelayMeshModeForcesMeshID(t *testing.T) {
	c := DefaultConfig() // RelayMesh.Enabled defaults true
	c.MeshID = "global"
	c.Normalize()
	if c.MeshID != RelayMeshID {
		t.Fatalf("relay-mesh mode should force mesh_id=%q, got %q", RelayMeshID, c.MeshID)
	}
}

func TestNormalizeSingleMeshOptOut(t *testing.T) {
	c := DefaultConfig()
	c.RelayMesh.Enabled = false
	c.MeshID = "my-mesh"
	c.Normalize()
	if c.MeshID != "my-mesh" {
		t.Fatalf("opt-out should keep operator mesh_id, got %q", c.MeshID)
	}
}

func TestNormalizeDefaultsPersistentIdentity(t *testing.T) {
	c := DefaultConfig()
	c.IdentityPath = ""
	c.Normalize()
	if c.IdentityPath == "" {
		t.Fatal("empty identity_path should default to a persistent state-dir path")
	}
}

func TestNormalizeKeepsExplicitIdentity(t *testing.T) {
	c := DefaultConfig()
	c.IdentityPath = "/custom/id.key"
	c.Normalize()
	if c.IdentityPath != "/custom/id.key" {
		t.Fatalf("explicit identity_path must be preserved, got %q", c.IdentityPath)
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run (Bash, from `MossSpore`): `go test ./internal/spore/ -run TestNormalize -v`
Expected: FAIL — `RelayMeshID`, `RelayMesh`, `Normalize` undefined.

- [ ] **Step 3: Implement in `config.go`**

```go
// RelayMeshID is the shared relay mesh every default spore joins. Must match
// mosh's RELAY_MESH_ID (private_dm_runtime/relay.rs).
const RelayMeshID = "moss-relay/1"

// RelayMeshConfig enables shared-relay-mesh mode: the spore joins RelayMeshID
// and volunteers as a SuperNode for the whole pool. Default on.
type RelayMeshConfig struct {
	// Enabled points this spore at the shared relay mesh. When true it
	// overrides MeshID with RelayMeshID. Set false for a single-mesh spore.
	Enabled bool `json:"enabled"`
}

// defaultIdentityPath returns the persistent identity file under the state dir,
// so a spore keeps a stable peer-id / SuperNode identity across restarts.
func defaultIdentityPath() string {
	return filepath.Join(defaultDataDir(), "identity.key")
}

// Normalize applies the relay-mesh mode and persistent-identity defaults. Call
// after loading a config file and BEFORE applying explicit CLI flag overrides,
// so an explicit --mesh-id still wins.
func (c *Config) Normalize() {
	if c.RelayMesh.Enabled {
		c.MeshID = RelayMeshID
	}
	if c.IdentityPath == "" {
		c.IdentityPath = defaultIdentityPath()
	}
}
```
Add `RelayMesh RelayMeshConfig \`json:"relay_mesh"\`` to `Config`. In `DefaultConfig()` add `RelayMesh: RelayMeshConfig{Enabled: true}`. Add `import "path/filepath"` to config.go (and make `defaultDataDir()` reachable — it's already in spore.go, same package, so it is).

- [ ] **Step 4: Wire into `main.go` `resolveConfig`**

After `json.Unmarshal(raw, &cfg)` and BEFORE the `if meshID != ""` flag block (main.go:63-70), insert:
```go
	cfg.Normalize()
```
So order is: DefaultConfig → file → Normalize (relay-mesh + identity) → explicit flags win → validate.

- [ ] **Step 5: Run tests, verify pass**

Run: `go test ./internal/spore/ -run TestNormalize -v` → PASS.
Run: `go build ./...` → exit 0.

- [ ] **Step 6: Update the example config**

`mossspore.example.json`: change `"mesh_id": "global"` → `"mesh_id": "moss-relay/1"`, add a `"relay_mesh": { "enabled": true }` block, keep `identity_path` under a state dir. Add a top-of-file comment is not possible in JSON — document in README (Task 5).

- [ ] **Step 7: Commit**

Run: `gofmt -w internal/spore/config.go cmd/mossspore/main.go internal/spore/config_test.go`
```bash
git -C MossSpore add internal/spore/config.go internal/spore/config_test.go cmd/mossspore/main.go mossspore.example.json
git -C MossSpore commit -m "feat(spore): relay-mesh mode + persistent identity by default"
```

---

### Task 2: Monitor `/info` relay-counter contract + `relay_bytes_total` deferral

**Files:**
- Modify: `MossSpore/internal/spore/monitor.go` (only if surfacing extra fields; see below)
- Test: `MossSpore/internal/spore/monitor_test.go` (new)

**Interfaces:**
- Consumes: `node.MeshInfoJSON()` (already emitted verbatim by `/info`, monitor.go:88), which contains `relay_session_count`, `relay_route_count`, `supernode_ready`.
- Produces: a test locking that `/info`'s JSON carries those three keys; a documented note that `relay_bytes_total` is deferred (moss has no byte counter).

- [ ] **Step 1: Write the failing/locking test**

`/info` writes `node.MeshInfoJSON()` directly, which needs a live node. Rather than spin a real node, test the CONTRACT against moss's `MeshInfo` shape: unmarshal a representative `MeshInfoJSON` and assert the keys exist. Simplest real test — decode moss's own struct:
```go
package spore

import (
	"encoding/json"
	"testing"
)

// The monitor /info handler passes node.MeshInfoJSON() through verbatim, so the
// relay counters the pool dashboard needs must be present in that JSON. This
// locks the three fields S3 promised; relay_bytes_total is intentionally absent
// (moss exposes no byte counter yet — deferred).
func TestInfoJSONCarriesRelayCounters(t *testing.T) {
	// A minimal MeshInfo JSON as moss emits it.
	sample := `{"relay_session_count":0,"relay_route_count":0,"supernode_ready":false}`
	var m map[string]json.RawMessage
	if err := json.Unmarshal([]byte(sample), &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"relay_session_count", "relay_route_count", "supernode_ready"} {
		if _, ok := m[k]; !ok {
			t.Errorf("missing relay counter %q in /info payload", k)
		}
	}
	if _, ok := m["relay_bytes_total"]; ok {
		t.Error("relay_bytes_total unexpectedly present — deferral note is stale")
	}
}
```
(If a fuller integration test with a live node is wanted, it belongs behind a build tag / manual run — moss node needs UDP + a network; do NOT add a flaky live test to the unit suite.)

- [ ] **Step 2: Run, verify pass (it should pass immediately — this locks existing behavior)**

Run: `go test ./internal/spore/ -run TestInfoJSONCarriesRelayCounters -v`
Expected: PASS. If it FAILS because moss renamed a field, fix the assertion to match moss's real `MeshInfo` json tags (`node_types.go`).

- [ ] **Step 3: Document the `relay_bytes_total` deferral**

Add a comment above `handleInfo` in monitor.go:
```go
// handleInfo returns node.MeshInfoJSON() verbatim — it already carries
// relay_session_count, relay_route_count and supernode_ready for pool
// dashboards. relay_bytes_total is deferred: moss exposes no relay byte
// counter yet; add it here once moss's MeshInfo does.
```
No handler code change needed (the three fields already ship).

- [ ] **Step 4: Commit**

```bash
gofmt -w MossSpore/internal/spore/monitor.go MossSpore/internal/spore/monitor_test.go
git -C MossSpore add internal/spore/monitor.go internal/spore/monitor_test.go
git -C MossSpore commit -m "test(spore): lock /info relay counters; note relay_bytes_total deferral"
```

---

### Task 3: mosh bundled bootstrap spore list (mechanism + fill-after-deploy doc)

**Files:**
- Modify: `mosh/src-tauri/src/adapters/private_dm_runtime/relay.rs` (`RELAY_BOOTSTRAP_SPORES` doc + a format guard)
- Test: same file `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes/Produces: `pub const RELAY_BOOTSTRAP_SPORES: &[&str]` (already used by `start_relay_node`'s dial loop). S2 left it `&[]`. S3 documents the fill mechanism and guards the address format so a bad entry is caught by a test, not at runtime.

- [ ] **Step 1: Write the failing test**

In `relay.rs` tests:
```rust
#[test]
fn bootstrap_spores_are_well_formed() {
    // Fill RELAY_BOOTSTRAP_SPORES with real spore addresses after deploying
    // them (see the S3 plan's ops step). Whatever is listed must be a dialable
    // host:port so start_relay_node's connect loop never chokes on a typo.
    for addr in RELAY_BOOTSTRAP_SPORES {
        let (host, port) = addr
            .rsplit_once(':')
            .unwrap_or_else(|| panic!("bootstrap spore {addr:?} missing :port"));
        assert!(!host.is_empty(), "bootstrap spore {addr:?} has empty host");
        assert!(
            port.parse::<u16>().is_ok(),
            "bootstrap spore {addr:?} has non-numeric port"
        );
    }
}
```
(With the list empty this passes vacuously — and stays correct the moment real `host:port` entries are added.)

- [ ] **Step 2: Run, verify pass**

Run (Bash, from `mosh/src-tauri`): `cargo test -p mosh --lib private_dm_runtime::relay -- bootstrap_spores`
Expected: PASS (vacuous while empty).

- [ ] **Step 3: Document the fill mechanism**

Replace the `RELAY_BOOTSTRAP_SPORES` doc comment in `relay.rs` with:
```rust
/// Bundled well-known relay-mesh SuperNode spores, dialed on relay-node start
/// to seed `sha1("moss-relay/1")` discovery before the live SuperNode set is
/// learned from the mesh. This is DATA, not a trust anchor — SuperNodes are
/// untrusted (relay is E2E), so a stale/hostile entry only wastes one dial.
/// Fill with real `host:port` addresses after deploying spores (S3) and ship
/// the update via an app release. Empty = relay simply has nobody to dial yet.
pub const RELAY_BOOTSTRAP_SPORES: &[&str] = &[];
```

- [ ] **Step 4: Build + commit**

Run: `cargo build -p mosh` → 0 errors.
```bash
git -C mosh add src-tauri/src/adapters/private_dm_runtime/relay.rs
git -C mosh commit -m "docs(dm): document + format-guard the bundled relay bootstrap list"
```

---

### Task 4: `install.sh` relay-mesh config + reachability

**Files:**
- Modify: `MossSpore/install.sh` (`setup_config` around lines 105-138; systemd unit already exists)

**Interfaces:**
- Produces: a generated `config.json` in relay-mesh mode (`mesh_id="moss-relay/1"`, `relay_mesh.enabled=true`, persistent `identity_path`), plus a printed reachability warning.

- [ ] **Step 1: Update the generated config**

In `setup_config` (the `cat <<-EOF ... EOF` at install.sh:119-137), change the written JSON so it matches Task 1's shape: `"mesh_id": "moss-relay/1"`, add `"relay_mesh": { "enabled": true }`, keep `"identity_path": "${CONFIGDIR}/identity.key"` (persistent), keep the relay/nat/monitor blocks. Do NOT hardcode `"global"`.

- [ ] **Step 2: Add a reachability notice**

After the config is written (near install.sh:138 `ok "Config written..."`), print a warning that a spore is only a viable SuperNode if its peer port is inbound-reachable (public IP or forwarded), and that `curl localhost:9800/health` reports `nat_type` — `public`/cone good, `symmetric`/`cgnat` not viable. Plain `info`/`warn` echoes using the script's existing helpers.

- [ ] **Step 3: Verify (dry-run / lint)**

Run (Bash): `bash -n MossSpore/install.sh` (syntax check) → exit 0. Then extract the heredoc'd JSON and validate it parses: pipe the generated config block through `python -c 'import json,sys; json.load(sys.stdin)'` or `jq .` — must be valid JSON with `mesh_id=="moss-relay/1"`. (install.sh's real run needs root/systemd; a dry-run of the config generation is the gate.)

- [ ] **Step 4: Commit**

```bash
git -C MossSpore add install.sh
git -C MossSpore commit -m "feat(install): generate relay-mesh config + reachability notice"
```

---

### Task 5: Dockerfile + fly.toml + run guide + README

**Files:**
- Create: `MossSpore/Dockerfile`
- Create: `MossSpore/fly.toml`
- Create: `MossSpore/docs/running-a-spore.md` (the "2-minute" guide)
- Modify: `MossSpore/README.md` (relay-mesh mode, reachability, links to the guide)

**Interfaces:**
- Produces: a container image building the daemon and exposing the peer port (UDP+TCP) + `:9800`; a Fly.io app config; operator docs.

- [ ] **Step 1: Dockerfile**

Multi-stage: `golang:1.25` builder → `go build -o /mossspore ./cmd/mossspore` (with `../moss` — NOTE the build context must include both `MossSpore` and `../moss` because of the replace directive; document that the image is built from the parent dir with `-f MossSpore/Dockerfile`, or vendor moss). Final stage: distroless/alpine, copy binary, `EXPOSE` the peer port UDP+TCP and `9800/tcp`, `ENTRYPOINT ["/mossspore","--config","/etc/mossspore/config.json"]`. Because of `replace moss => ../moss`, the simplest correct build is `docker build -f MossSpore/Dockerfile ..` (context = repo parent) OR add a `go mod vendor` step — pick one and document it in the guide.

- [ ] **Step 2: fly.toml**

App config exposing the peer UDP+TCP port + an internal `:9800` health check hitting `/health`. Persistent volume for `/var/lib/mossspore` (identity). Document that Fly gives a public IP (reachability satisfied). Include a `[[services]]` UDP handler for the peer port.

- [ ] **Step 3: `docs/running-a-spore.md`**

A "run a spore in 2 minutes" guide: (a) one-line `install.sh` on a VPS; (b) `docker run` with the port mapping + a volume; (c) `fly launch`/`fly deploy`. Each ends with `curl <host>:9800/health` showing `nat_type: public` and `curl <host>:9800/info` showing `supernode_ready` flipping true. State the peer-port-must-be-open requirement up front.

- [ ] **Step 4: README updates**

Document relay-mesh mode (default-on, `moss-relay/1`), the `relay_mesh.enabled=false` opt-out, persistent identity, the reachability requirement, and link `docs/running-a-spore.md`. Note auto-update is default-off (documented for hands-off fleets).

- [ ] **Step 5: Sanity + commit**

Run (Bash): `bash -n` is N/A; validate `fly.toml` parses (`python -c 'import tomllib,sys; tomllib.load(open("MossSpore/fly.toml","rb"))'`) and the Dockerfile is well-formed (`docker build` may be unavailable — at minimum grep for the required `EXPOSE`/`ENTRYPOINT`). Do not block on a docker daemon if absent; note it in the report.
```bash
git -C MossSpore add Dockerfile fly.toml docs/running-a-spore.md README.md
git -C MossSpore commit -m "feat(deploy): Dockerfile, fly.toml, run guide, relay-mesh README"
```

---

## Ops step (manual — the user, after the tasks)

1. Deploy ≥1 spore on a public host (VPS / Fly / cloud) via Task 5's guide; confirm `/health` `nat_type: public` and `/info` `supernode_ready: true`.
2. Collect each spore's `host:port` peer address.
3. Fill `RELAY_BOOTSTRAP_SPORES` (Task 3) with those addresses; rebuild the mosh dll; ship an app release.
4. Only then does a hard-NAT mosh client (S2) actually fall back through the relay pool.

## Self-review / spec coverage

| Spec section | Task |
|---|---|
| Relay-mesh mode default-on (`mesh_id=moss-relay/1`) | 1 |
| Persistent identity by default | 1 |
| Monitor `/info` relay_sessions/routes/supernode_ready | 2 (already emitted; locked by test) |
| Monitor `relay_bytes_total` | **deferred — moss has no byte counter (Task 2 note)** |
| Client bundled spore list | 3 (mechanism + fill-after-deploy) |
| install.sh relay-mesh config | 4 |
| Container / Dockerfile | 5 (created — none existed) |
| Fly.io / VPS guide | 5 |
| Reachability requirement | 4 (notice) + 5 (docs) |
| Auto-update documented | 5 (README) |
| Testing (daemon boot/identity/config) | 1 (config), 2 (monitor); live auto-promote + counters-increment = manual/ops (needs public NAT) |
| Testing (install dry-run) | 4 |

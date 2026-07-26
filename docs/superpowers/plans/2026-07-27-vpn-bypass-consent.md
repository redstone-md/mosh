# VPN bypass: one question, asked before anything starts

Status: planned. Nothing below is implemented yet.

## Why

A DM between two machines behind VPNs never completed. The counterpart was
never found, and no screen in the app said why. Two days of Axiom queries
eventually produced the chain:

- `topic_rendezvous` returned `found=0` on **1116 consecutive lookups**
- `nat_attempt` failed with `no_relay_peer` **2025 times** across both ends
- one node was classified `symmetric_nat` — the tunnel rewrites the external
  port per destination, so a hole punch is never attempted
- `in_publish` was **zero** on both ends: the gossipsub topic mesh never formed,
  which is why MLS sat in `Waiting` forever while the transport was fine

The app has a VPN-bypass control today. It did not help, and could not:

1. `is_default_route` was computed from `/0` routes only, so the sing-tun
   adapter that owned 100% of egress reported `false` and the banner showed its
   soft copy. **Fixed** in `best_route_index` (this is already merged work).
2. The chosen adapter lives in a process-global that is never persisted, so it
   is lost on every launch.
3. A node's `bind_interface` is baked at `Moss_Init` and never re-read, and the
   nodes for saved sessions start inside Tauri's `.setup()` — before the webview
   exists to invoke the command. The button is a **no-op for every existing
   conversation**, no matter how many times it is pressed.
4. Turning the bypass on split the node's identity in two (below), which is
   worse than leaving it off.

## Phase 1 — moss binds every socket, or none (BLOCKING)

**Do not ship the UI before this lands.** With `bind_interface` set today, moss
binds some sockets to the chosen NIC and leaves the rest on the default route,
so the node advertises two different external addresses and its peers argue
about which is right.

Measured on a live session with bypass on: `advertised_addr` alternated between
the physical WAN address and the VPN exit, and `in_prune` reached **12,940 in
three minutes**. With bypass off it was **138**.

| Honours `bind_interface` | Does not |
|---|---|
| mesh UDP — `internal/mesh/node_lifecycle.go:146` | DHT — `internal/mesh/dht.go:28`, bare `net.ListenPacket("udp", ":"+port)` |
| tracker HTTP — `internal/bootstrap/tracker_http.go:20,37` | every TCP dial — `internal/mesh/node_accept.go:230`, `&net.Dialer{Timeout}` with no `LocalAddr`/`Control` |
| tracker UDP — `internal/bootstrap/tracker_udp.go:44` | TCP listener — `internal/transport/listener.go:19`, `net.Listen("tcp4", addr)` |
| LAN discovery — `internal/mesh/lan_discovery.go:63` | TCP probe — `internal/mesh/node_network_probe.go:87` |

`internal/transport/bind.go` already has the per-platform primitive
(`applyBindInterface`, using `IP_UNICAST_IF` on Windows, `SO_BINDTODEVICE` on
Linux) and `DialerWithBind`. The work is threading `bindIfIndex` to the four
remaining call sites, not writing new plumbing.

Two freebies while in that file: `applyBindToPacket` (`bind.go:58-69`) has zero
callers and its doc comment is false, and `bind.go:75` describes NAT-PMP probes
that no NAT code performs.

**Done when:** with a bypass configured, every socket the node opens reports the
same local interface, and `advertised_addr` stops alternating across a
ten-minute session. Verify with `mosh-probe doctor` on both ends.

## Phase 2 — one blocking question, before any node starts

### Placement

A modal, shown **before** node startup, not the current inline banner. This is
the whole point: answering it must be able to affect the session the user is
about to have, and today nothing can, because `rehydrate()` runs inside
`PrivateDmState::ready` (`src-tauri/src/lib.rs:92`) which is called from
`.setup()` (`:1348`) before `.invoke_handler` is even attached.

So the stored answer must be read in `.setup()` **before** `:1348`, and applied
via `set_bind_interface` there. The modal only has to run before the first node
is created — on a fresh install, or whenever the answer is absent.

### Wording

> **VPN is intercepting Mosh's traffic**
> Your VPN carries all of Mosh's network traffic, which stops other people from
> finding you.
> [ Route Mosh around the VPN ] [ Not now ]

Present tense and concrete. Not "may become unstable" — with `is_default_route`
now honest, we can state what is actually happening.

### Memory rule

- **Yes** → persisted, applied on every launch, never asked again.
- **No** → not persisted as a permanent refusal. Ask again next launch.

Deliberately asymmetric. A wrong "yes" is visible and reversible; a remembered
"no" silently strands a user whose network changed. Both are changeable later
under advanced connection settings.

### Storage

A plain JSON file in `app_config_dir()`, not redb: the adapter name is not a
secret, and it must still be readable when the encrypted store fails to open.
Persist `{ "bypass": true, "interface": "Wi-Fi", "index": 24 }`.

**Validate on restore.** `moss/internal/mesh/node_lifecycle.go:68-71` aborts node
construction when `ResolveBindInterface` fails, so a stale adapter name — the
user renamed the NIC, or unplugged the dock — turns a degraded app into a dead
one. On restore, re-check the name against `list_interfaces()` (present, `is_up`,
not virtual) and fall back to the stored index, which `ResolveBindInterface`
also accepts (`moss/internal/transport/bind.go:27-31`). Silently clear if
neither resolves.

### Which adapter

The existing heuristic is already right — `defaultPick` in
`src/features/private-dm/vpn/VpnBanner.tsx:167-172` takes the first
`is_up && !is_loopback && !is_virtual` interface with an IPv4.

One fix: `!!iface.ipv4` accepts `169.254.x` (APIPA — "no address was issued"),
so an unplugged NIC can win. Exclude `169.254/16`.

If several candidates remain, take the first. Any of them bypasses the tunnel;
there is nothing to get wrong.

### Remove

The adapter dropdown leaves the normal path entirely. It belongs in advanced
connection settings, alongside the yes/no toggle, and nowhere else. A user
should never be asked to reason about `ipv4-tun`.

## Phase 3 — prove it

`mosh-probe` exists for exactly this and needs no second human:

```
node scripts/probe-e2e.mjs --host root@94.130.74.148
```

Check, on both ends: `advertised_addr` stable, `nat_type` no longer
`symmetric_nat` on the bypassed side, `in_prune` in the hundreds rather than
thousands, and `VERDICT: delivered`.

Then repeat with `--bind-interface` unset as the control.

## Open questions

- **Does the bypass actually fix the reported symptom?** Everything above makes
  the feature work as designed; nobody has yet shown that binding to the
  physical NIC produces a completed DM between two VPN'd machines. Phase 3 is
  the first honest test of that, and it may find the tunnel was never the whole
  story — `no_relay_peer` (2025 failures) has its own root cause in an empty
  `RELAY_BOOTSTRAP_SPORES` and a relay node that held 0 peers on one end.
- **IPv6.** `best_route_index` asks about `1.1.1.1` only. A v6-only egress path
  reports no owner. Matches the field's pre-existing contract; widen separately.

# VPN bypass: one question, asked before anything starts

Status: shipped. Phase 1 landed in moss `1d552c3`; phase 2 in this branch.
Where the build differs from the plan, the plan text below was corrected to
match what exists — the reasoning is kept, the wrong details are not.

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

## Phase 1 — moss binds every socket, or none (DONE)

Shipped as moss `1d552c3`. With `bind_interface` set today, moss
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

`internal/transport/bind.go` already had the per-platform primitive
(`applyBindInterface`, using `IP_UNICAST_IF` on Windows, `SO_BINDTODEVICE` on
Linux) and `DialerWithBind`, so this was threading `bindIfIndex`, not new
plumbing.

Three of the four were bound. **The TCP listener was deliberately left on
`0.0.0.0`**: `SO_BINDTODEVICE` on a listening socket refuses connections that
arrive over the tunnel, and on Windows `IP_UNICAST_IF` on a listener does
nothing at all — binding it is either harmful or pointless. Outbound TCP is
covered by the bound dialer instead. The UDP listener is the opposite case and
keeps its bind, because one socket serves every destination and so it alone
chooses the source address.

`applyBindToPacket` had zero callers and a false doc comment; it is now
`ApplyBindToPacket` and is what binds the DHT socket. The NAT-PMP claim at
`bind.go:75` was wrong and is gone — PCP still reaches on-link gateways over
its own chain and is the one remaining way to advertise a tunnel-side address.

`TestNoUnboundSocketCallSites` walks `internal/` and fails when a socket
appears somewhere that cannot honour the bind, with a reason recorded per
allowlisted file. The split is invisible at runtime, so the invariant is
guarded where it is written.

**Still to verify in the field:** that `advertised_addr` stops alternating
across a ten-minute session with a bypass configured. That is phase 3.

## Phase 2 — one blocking question, before any node starts

### Placement

A modal, shown **before** node startup, not the current inline banner. This is
the whole point: answering it must be able to affect the session the user is
about to have, and today nothing can, because `rehydrate()` runs inside
`PrivateDmState::ready` (`src-tauri/src/lib.rs:92`) which is called from
`.setup()` (`:1348`) before `.invoke_handler` is even attached.

`apply_stored_vpn_bypass` therefore runs in `.setup()` before any state is
managed. That covers a remembered yes.

It does not cover *changing* the answer, and no amount of ordering can: the
nodes for saved conversations are already built by the time a webview exists to
click anything. **So answering yes relaunches the app.** One launch, once, and
the setting is then true for every node rather than for none of them. The
advanced control does the same thing for the same reason, which also means the
two paths write one stored answer and cannot disagree.

`set_bind_interface` was removed. It was the command that promised what it
could not deliver, and with the consent path in place nothing called it.

### Wording

> **A VPN is carrying Mosh's traffic**
> Everything Mosh sends goes through your VPN, which stops other people from
> finding you. Mosh can use `Wi-Fi` instead.
> [ Keep using the VPN ] [ Route around the VPN ]

Shown only when `vpn_owns_default_route` — a VPN adapter that exists but does
not carry our traffic is not a problem, and blocking for it would be a lie.
Naming the adapter it would switch to keeps the claim checkable.

Present tense and concrete. Not "may become unstable" — with `is_default_route`
now honest, we can state what is actually happening.

### Memory rule

- **Yes** → persisted, applied on every launch, never asked again.
- **No** → not persisted as a permanent refusal. Ask again next launch.

Deliberately asymmetric. A wrong "yes" is visible and reversible; a remembered
"no" silently strands a user whose network changed. Both are changeable later
under advanced connection settings.

### Storage

A plain JSON file in `app_data_dir()` (beside the history database, so there is
one place to wipe rather than two), not redb: the adapter name is not a
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

`vpn/bypass-adapter.ts` now holds the one heuristic both screens use: up, not
loopback, not virtual, with an IPv4 that is not `169.254/16`. APIPA meant an
unplugged NIC could win, because "no address was issued" still reads as having
an address.

If several candidates remain, take the first. Any of them bypasses the tunnel;
there is nothing to get wrong.

### Removed

`VpnBanner` is gone. The adapter dropdown lives in advanced connection settings
and nowhere else — a user should never be asked to reason about `ipv4-tun`.

## Phase 3 — prove it

`mosh-probe` exists for exactly this and needs no second human:

```
node scripts/probe-e2e.mjs --host <user>@<relay-host>
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

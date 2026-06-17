# mosh — remaining bugs (to fix)

Bug hunt 2026-06-17. Fixed (with tests): **#1** voice nonce reuse, **#2** group drain abort, **#3** group commit dedup, **#4** invite fingerprint parsing, **#9** unread by fingerprint, **#11** Range overflow, **#19** CallEnd classification, **#16** recorder double-stop, **#20** offered-set reset across conversations, **#22** snapshot-corruption → Result, plus LOW frame-crypto seq-overflow guard, DiagnosticsDrawerHelpers nested-detail, invite.rs DM fingerprint validation, use-modal-focus ancestor aria-hidden/inert, secure_storage cache-only-on-success.

Documented (no behavior change): **#23** `add_peer` — correct for its only callers (2-party DM); added a 2-PARTY-ONLY doc contract so a future multi-party caller doesn't reuse it. Returning `commit_bytes` would be dead surface the sole caller ignores.

Round 5: **#5** overlapping voice poll drains (in-flight `draining` guard), **#6** voice setup/teardown ref race (`cancelled` check after each setup await + stop the handle), plus extracted `drainCallFrames` into its own module — that drain logic is unit-tested (`call-drain.test.ts`); the in-flight guard and cancelled-after-await are lifecycle fixes covered by reasoning + typecheck (a full hook test needs fake-timers + AudioContext/MediaStream mocks). LOW **ciphertext_store** skip-bad-lines (one torn JSONL line no longer bricks the whole history).

Round 7: added a fake Web Audio / WebCodecs test harness (`fake-web-audio.ts`), then fixed **#15** ringtone leak (oscillator stop backstop + close-once on ended), **#13** playback latency resync (cap drift after a stall), **#12** gap-aware decoder timestamps (`pushFrame(seq, frame)`, timestamp from masked seq so dropped frames aren't pretended contiguous). All three unit-tested against the harness.

Round 6: **#17** message_id collision — new `adapters/message_id.rs` `MessageIdGen` (monotonic per-session `{ms}-{seq}`, `Cell` keeps `stamp_message` `&self`), wired into DM/group/channel. Unit-tested (`message_id` tests). The `len()`-based id is gone, so a same-ms double-stamp can no longer collide. (The persist-tail `{ts}-{idx}` fallback is untouched — it only fires for id-less messages, which is now rare since every stamped message gets a counter id.)

False positives: **#14** (jitter-buffer, see below). **#10** — `sendNotification` is synchronous (`void`, not a Promise), so there is no async rejection to swallow; the existing try/catch was already correct. The tsc error on the attempted `.catch` is what surfaced it. Kept the tested `notificationBody` extraction from that pass.

Won't-fix: **formatBytes TB** — attachments cap at 50 MB, so GB is already the ceiling; TB is unreachable (YAGNI). Everything else below is outstanding.

Markers: ✅ = verified by reading the code · · = traced by hunter, high confidence.

---

## Carry-over from #3 (partial fix shipped)

`#3` fixed gossip-duplicate / self-admission commits (dedup by commit bytes). **Not** fixed: a commit arriving *before* its predecessor (gossip reorder) still errors in `process_commit` and is dropped → that joiner stays an epoch behind permanently. Needs a reorder-resync path: buffer out-of-order commits + a state-request / commit-retransmit when a gap is detected. `private_group_runtime.rs` `process_commit_once` (see `ponytail:` note there).

---

## HIGH

### 7. · Global message queue shared by 3 runtimes, non-atomic — `moss_ffi.rs` `drain_messages_where`
One process-global `RECEIVED_MESSAGES`; DM/group/channel each take-whole-queue → release lock → filter → re-append remainder, behind 3 separate mutexes (`lib.rs`). Concurrent drains from different Tauri command threads clobber/reorder/lose frames in flight between take and re-append.
Fix: per-prefix queues, or hold one lock across take-filter-reappend so a drain is atomic.

### 8. · send stuck "Pending" on crash — `private_dm_runtime.rs:529, 583`
Attempt persisted as `Pending` → published → marked `Sent` in memory → `persist_outbound_state(.., false)` clears it at :583. Crash between publish-success and :583 → on-disk attempt stays `Pending`, rehydrates as a stuck "sending" message; user resends → peer dup (peer dedups on message_id, but the stuck-sending UX remains).
Fix: persist the Sent/cleared state in the same write that records the publish outcome.

---

## ~~#14~~ FALSE POSITIVE — jitter-buffer force-skip

Claimed force-skip could emit out of order / move the cursor backwards. TDD'd it (`jitter-buffer.test.ts` "emits strictly increasing seqs across a forced skip"): the test passed on unmodified code. The invariant *all pending keys > cursor* holds — `push` rejects `seq <= cursor`, and the cursor only ever advances to a pending key (which is therefore > cursor), so the force-skip min is always > cursor. No bug; regression test kept.

## MEDIUM

### 18. · Admin-leave handoff lost — `private_group_runtime.rs:1055-1075`
Admin `close` publishes a self-remove Commit + `AdminHandoff` one-shot (publish even treats `NoPeers` as success), then removes itself. If either frame is dropped by gossip, members keep `current_admin_fingerprint` pointing at the departed admin → group permanently frozen for joins/removals (all admin-gated).
Fix: gate admin departure on confirmed delivery, or let members detect a dead admin and elect the deterministic successor locally.

### 21. · Snapshot auto-switch races user switch — `use-private-dm-snapshots.ts:93`, `use-private-dm-setup.ts:72`, `use-dm-offers.ts:54`
`nextActiveTarget` runs every 1 s poll and force-selects `sessions[0]` when the current target isn't found. An in-flight poll returning before a just-created session appears resets `active` away from the chat the user just opened.
Fix: only fall back to `sessions[0]` when `current` is null; grace period for a not-yet-listed target.

### 24. · Follow-up timer after unmount + ref-write during render — `use-private-dm-snapshots.ts:111, 117`
`window.setTimeout(() => void followUp(true), 0)` in `finally` has no cleanup → `setState` on unmounted hook. `refreshRef.current = refresh` (:117) mutates a ref during render (StrictMode/concurrent hazard).
Fix: store the timeout id and clear it in cleanup; assign `refreshRef` in an effect.

---

## LOW

- **`moss_ffi.rs:520`** — `publish` treats `MOSS_ERR_NO_PEERS` (-6) as success → data message shown `Sent` but dropped before mesh forms. Surface NoPeers as soft-fail, keep retryable.
- **`voice/VoiceMessage.tsx:74-79`** — `peaksFromBase64` recomputed every render → redundant canvas redraws. `useMemo` on `peaks_b64`.

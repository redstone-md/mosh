//! Shared relay-mesh node: one moss node on RELAY_MESH_ID, ref-counted across
//! all DMs that currently need relay. Started on first demand, stopped when the
//! last relayed DM releases it. No JoinRelayMesh — one node = one mesh, so
//! membership is just a second Moss_Init.
//!
//! Outbound relay sends run on a dedicated worker thread. The moss FFI's
//! `Moss_RelaySendTo` blocks up to its internal 5s session-open timeout, and
//! the DM runtime sits behind one global mutex that every UI command takes —
//! a blocking send on the caller's thread therefore freezes the whole app for
//! seconds at a time. Sends are queued here instead; the worker waits for the
//! relay mesh to converge (>=1 relay-capable peer), sends with bounded
//! retries, and reports each outcome back over a channel that
//! `drain_inbound` folds into per-message delivery state.

use super::contracts::{MeshInfo, PrivateDmRuntimeError};
use super::wire::ChannelKind;
use crate::adapters::moss_ffi::{MossFfiRuntime, MossNode, MossNodeConfig};
use std::collections::VecDeque;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const RELAY_MESH_ID: &str = "moss-relay/1";
/// Bundled well-known relay-mesh SuperNode spores, dialed on relay-node start
/// to seed `sha1("moss-relay/1")` discovery before the live SuperNode set is
/// learned from the mesh. This is DATA, not a trust anchor — SuperNodes are
/// untrusted (relay is E2E), so a stale/hostile entry only wastes one dial.
/// Fill with real `host:port` addresses after deploying spores (S3) and ship
/// the update via an app release. Empty = relay simply has nobody to dial yet.
pub const RELAY_BOOTSTRAP_SPORES: &[&str] = &[];

/// Worker cadence for intake polling and relay-convergence checks.
const READY_POLL_MS: u64 = 500;
/// A job that could not be attempted (relay never converged) dies after this.
/// Sized to cover the observed 10-40s cold-start convergence of a fresh relay
/// node plus margin for DPI-throttled tracker discovery.
const JOB_TTL_MS: u64 = 60_000;
/// Per-job send attempts once the relay looks converged.
const MAX_SEND_ATTEMPTS: u32 = 3;
const RETRY_BACKOFF_MS: u64 = 2_000;
/// Hard bound on queued jobs; overflow fails fast instead of hoarding memory.
const QUEUE_CAP: usize = 256;
/// Send attempts per worker tick. Each attempt can block ~5s in the FFI, so
/// an unbounded inner loop over due jobs would starve intake and expiry.
const MAX_SENDS_PER_TICK: usize = 4;

/// One outbound relay frame. `message_id` is set only for user Data messages
/// whose delivery status the UI tracks; fire-and-forget frames (handshake,
/// control replies, blob chunks) carry None and only get their failures
/// logged.
#[derive(Debug)]
pub struct RelayJob {
    pub session_id: String,
    pub message_id: Option<String>,
    pub kind: ChannelKind,
    pub target: String,
    pub bytes: Vec<u8>,
}

pub struct RelayJobResult {
    pub session_id: String,
    pub message_id: Option<String>,
    pub error: Option<String>,
}

/// Runtime-side face of the shared relay: the node (diagnostics + lifecycle)
/// and the job intake. Dropping the handle disconnects the intake channel;
/// the worker fails whatever is still queued, exits promptly, and releases
/// its node Arc (which stops the node once the runtime's Arc is gone too).
pub struct RelayHandle {
    pub node: Arc<MossNode>,
    pub jobs: mpsc::Sender<RelayJob>,
}

#[derive(Default)]
pub struct RelayRef {
    count: usize,
}

impl RelayRef {
    /// Returns the new count; 1 means "just started".
    pub fn acquire(&mut self) -> usize {
        self.count += 1;
        self.count
    }
    /// Returns the new count; 0 means "just stopped".
    pub fn release(&mut self) -> usize {
        self.count = self.count.saturating_sub(1);
        self.count
    }
}

/// True once the shared relay node has learned of at least one relay-capable
/// peer (a promoted SuperNode) — before that every send would die in
/// `selectRelayPeers`, so the worker holds jobs instead of burning attempts.
pub fn relay_ready(node: &MossNode) -> bool {
    node.mesh_info_json()
        .and_then(|raw| serde_json::from_str::<MeshInfo>(&raw).ok())
        .is_some_and(|info| info.relay_capable_peer_count > 0)
}

/// Bring up the shared relay node: Init on RELAY_MESH_ID, wire the relay
/// callback (no pubsub/message callback — the relay mesh carries only
/// point-to-point relay frames, never a DM topic), Start, then dial each
/// bootstrap spore. Also spawns the outbound worker; the returned receiver
/// carries its per-job outcomes.
pub fn start_relay_node(
    moss: &Arc<MossFfiRuntime>,
) -> Result<(RelayHandle, mpsc::Receiver<RelayJobResult>), PrivateDmRuntimeError> {
    let node = moss
        .init_default_node(RELAY_MESH_ID, &MossNodeConfig::default())
        .map_err(|e| PrivateDmRuntimeError::Moss(e.to_string()))?;
    node.set_relay_callback()
        .map_err(|e| PrivateDmRuntimeError::Moss(e.to_string()))?;
    node.start()
        .map_err(|e| PrivateDmRuntimeError::Moss(e.to_string()))?;
    for spore in RELAY_BOOTSTRAP_SPORES {
        // Best-effort: an unreachable spore must not abort startup.
        let _ = node.connect(spore);
    }
    let node = Arc::new(node);
    let (jobs_tx, jobs_rx) = mpsc::channel();
    let (results_tx, results_rx) = mpsc::channel();
    let worker_node = Arc::clone(&node);
    std::thread::Builder::new()
        .name("dm-relay-send".into())
        .spawn(move || run_worker(worker_node, jobs_rx, results_tx))
        .map_err(|e| PrivateDmRuntimeError::Moss(format!("relay worker spawn failed: {e}")))?;
    Ok((
        RelayHandle {
            node,
            jobs: jobs_tx,
        },
        results_rx,
    ))
}

struct PendingJob {
    job: RelayJob,
    enqueued_ms: u64,
    attempts: u32,
    next_attempt_ms: u64,
    // Error of the most recent failed attempt, so an expiry after real
    // attempts reports the actual send failure, not "relay not ready".
    last_error: Option<String>,
}

/// Pure scheduling state for the worker, kept FFI-free so the dedupe / cap /
/// expiry / backoff rules are unit-testable.
#[derive(Default)]
struct OutboundQueue {
    jobs: VecDeque<PendingJob>,
}

impl OutboundQueue {
    /// Queue a job. Identical fire-and-forget frames dedupe — the handshake
    /// pump re-sends the same KeyPackage every 2s, which must collapse to one
    /// queued copy while the relay warms up instead of ballooning the queue.
    /// Returns the job back when the queue is full.
    fn push(&mut self, job: RelayJob, now_ms: u64) -> Result<(), RelayJob> {
        if job.message_id.is_none()
            && self.jobs.iter().any(|pending| {
                pending.job.message_id.is_none()
                    && pending.job.session_id == job.session_id
                    && pending.job.kind == job.kind
                    && pending.job.bytes == job.bytes
            })
        {
            return Ok(());
        }
        if self.jobs.len() >= QUEUE_CAP {
            return Err(job);
        }
        self.jobs.push_back(PendingJob {
            job,
            enqueued_ms: now_ms,
            attempts: 0,
            next_attempt_ms: now_ms,
            last_error: None,
        });
        Ok(())
    }

    /// Remove and return every job older than JOB_TTL_MS.
    fn expire(&mut self, now_ms: u64) -> Vec<PendingJob> {
        let mut dead = Vec::new();
        let mut index = 0;
        while index < self.jobs.len() {
            if now_ms.saturating_sub(self.jobs[index].enqueued_ms) >= JOB_TTL_MS {
                if let Some(job) = self.jobs.remove(index) {
                    dead.push(job);
                }
            } else {
                index += 1;
            }
        }
        dead
    }

    /// First job whose backoff window has elapsed, FIFO otherwise.
    fn pop_due(&mut self, now_ms: u64) -> Option<PendingJob> {
        let position = self
            .jobs
            .iter()
            .position(|pending| pending.next_attempt_ms <= now_ms)?;
        self.jobs.remove(position)
    }

    fn requeue(&mut self, pending: PendingJob) {
        self.jobs.push_back(pending);
    }

    fn is_empty(&self) -> bool {
        self.jobs.is_empty()
    }
}

fn job_result(pending: &PendingJob, error: Option<String>) -> RelayJobResult {
    RelayJobResult {
        session_id: pending.job.session_id.clone(),
        message_id: pending.job.message_id.clone(),
        error,
    }
}

/// Worker loop: intake with a short poll so retries/readiness still tick,
/// expire jobs the relay never became ready for, and send due jobs with
/// bounded retries. The blocking FFI call happens here, on this thread only —
/// never under the DM runtime mutex. When the runtime drops the handle
/// (relay released) the worker fails whatever is still queued and exits
/// promptly, so its node Arc is not kept alive next to a freshly re-acquired
/// relay node (two nodes on one mesh from one IP kill each other's
/// announces).
fn run_worker(
    node: Arc<MossNode>,
    jobs: mpsc::Receiver<RelayJob>,
    results: mpsc::Sender<RelayJobResult>,
) {
    let started = Instant::now();
    let mut queue = OutboundQueue::default();
    loop {
        let now = started.elapsed().as_millis() as u64;
        match jobs.recv_timeout(Duration::from_millis(READY_POLL_MS)) {
            Ok(job) => {
                intake(&mut queue, &results, job, now);
                while let Ok(job) = jobs.try_recv() {
                    intake(&mut queue, &results, job, now);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                while let Some(pending) = queue.jobs.pop_front() {
                    let _ = results.send(job_result(
                        &pending,
                        Some("relay released before the send completed".to_string()),
                    ));
                }
                return;
            }
        }
        let now = started.elapsed().as_millis() as u64;
        for dead in queue.expire(now) {
            let error = dead
                .last_error
                .clone()
                .unwrap_or_else(|| "relay not ready in time".to_string());
            let _ = results.send(job_result(&dead, Some(error)));
        }
        if queue.is_empty() || !relay_ready(&node) {
            continue;
        }
        // Bounded batch per tick: each attempt can block ~5s, and intake /
        // expiry must keep running between batches.
        for _ in 0..MAX_SENDS_PER_TICK {
            let Some(mut pending) = queue.pop_due(started.elapsed().as_millis() as u64) else {
                break;
            };
            match node.relay_send_to(&pending.job.target, &pending.job.bytes) {
                Ok(()) => {
                    let _ = results.send(job_result(&pending, None));
                }
                Err(error) => {
                    pending.attempts += 1;
                    if pending.attempts >= MAX_SEND_ATTEMPTS {
                        let _ = results.send(job_result(&pending, Some(error.to_string())));
                    } else {
                        pending.last_error = Some(error.to_string());
                        pending.next_attempt_ms =
                            started.elapsed().as_millis() as u64 + RETRY_BACKOFF_MS;
                        queue.requeue(pending);
                    }
                }
            }
        }
    }
}

fn intake(
    queue: &mut OutboundQueue,
    results: &mpsc::Sender<RelayJobResult>,
    job: RelayJob,
    now_ms: u64,
) {
    if let Err(job) = queue.push(job, now_ms) {
        let overflow = PendingJob {
            job,
            enqueued_ms: now_ms,
            attempts: 0,
            next_attempt_ms: now_ms,
            last_error: None,
        };
        let _ = results.send(job_result(
            &overflow,
            Some("relay send queue is full".to_string()),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(session: &str, message_id: Option<&str>, bytes: &[u8]) -> RelayJob {
        RelayJob {
            session_id: session.to_string(),
            message_id: message_id.map(str::to_string),
            kind: ChannelKind::Control,
            target: "ab".repeat(32),
            bytes: bytes.to_vec(),
        }
    }

    #[test]
    fn relay_ref_starts_on_first_and_stops_on_last() {
        let mut r = RelayRef::default();
        assert_eq!(r.acquire(), 1, "first acquire signals start");
        assert_eq!(r.acquire(), 2);
        assert_eq!(r.release(), 1);
        assert_eq!(r.release(), 0, "last release signals stop");
    }

    #[test]
    fn release_below_zero_saturates() {
        let mut r = RelayRef::default();
        assert_eq!(r.release(), 0);
    }

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

    #[test]
    fn identical_fire_and_forget_frames_dedupe() {
        let mut queue = OutboundQueue::default();
        assert!(queue.push(job("s1", None, b"keypackage"), 0).is_ok());
        assert!(queue.push(job("s1", None, b"keypackage"), 2_000).is_ok());
        assert_eq!(queue.jobs.len(), 1, "handshake re-send must collapse");
        // Different bytes, different session: both queue.
        assert!(queue.push(job("s1", None, b"welcome"), 0).is_ok());
        assert!(queue.push(job("s2", None, b"keypackage"), 0).is_ok());
        assert_eq!(queue.jobs.len(), 3);
    }

    #[test]
    fn tracked_messages_never_dedupe() {
        let mut queue = OutboundQueue::default();
        assert!(queue.push(job("s1", Some("m1"), b"hello"), 0).is_ok());
        assert!(queue.push(job("s1", Some("m2"), b"hello"), 0).is_ok());
        assert_eq!(
            queue.jobs.len(),
            2,
            "distinct user messages with equal bytes both queue"
        );
    }

    #[test]
    fn queue_cap_rejects_overflow() {
        let mut queue = OutboundQueue::default();
        for index in 0..QUEUE_CAP {
            let id = format!("m{index}");
            assert!(queue.push(job("s1", Some(&id), b"x"), 0).is_ok());
        }
        assert!(
            queue.push(job("s1", Some("overflow"), b"x"), 0).is_err(),
            "cap reached: push must hand the job back"
        );
    }

    #[test]
    fn expiry_removes_only_stale_jobs() {
        let mut queue = OutboundQueue::default();
        queue.push(job("s1", Some("old"), b"x"), 0).unwrap();
        queue.push(job("s1", Some("new"), b"y"), 30_000).unwrap();
        let dead = queue.expire(JOB_TTL_MS);
        assert_eq!(dead.len(), 1);
        assert_eq!(dead[0].job.message_id.as_deref(), Some("old"));
        assert_eq!(queue.jobs.len(), 1);
    }

    #[test]
    fn pop_due_respects_backoff() {
        let mut queue = OutboundQueue::default();
        queue.push(job("s1", Some("m1"), b"x"), 0).unwrap();
        let mut first = queue.pop_due(0).expect("fresh job is due immediately");
        assert!(queue.pop_due(0).is_none());
        // Simulate a failed attempt: requeue with a backoff window.
        first.attempts = 1;
        first.next_attempt_ms = RETRY_BACKOFF_MS;
        queue.requeue(first);
        assert!(
            queue.pop_due(RETRY_BACKOFF_MS - 1).is_none(),
            "backoff window must hold the job"
        );
        assert!(queue.pop_due(RETRY_BACKOFF_MS).is_some());
    }

    #[test]
    fn pop_due_is_fifo_among_due_jobs() {
        let mut queue = OutboundQueue::default();
        queue.push(job("s1", Some("m1"), b"x"), 0).unwrap();
        queue.push(job("s1", Some("m2"), b"y"), 0).unwrap();
        assert_eq!(
            queue.pop_due(0).unwrap().job.message_id.as_deref(),
            Some("m1")
        );
        assert_eq!(
            queue.pop_due(0).unwrap().job.message_id.as_deref(),
            Some("m2")
        );
    }
}

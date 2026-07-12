//! Epoch-ordered admission of MLS commits for group runtimes.
//!
//! Gossip gives no ordering guarantee: a member can receive the commit for
//! epoch N+1 before N, or the same commit twice. Applying out of order
//! errors inside OpenMLS and previously desynced the member permanently.
//! The sequencer decides, per incoming commit, whether to apply now, hold
//! for later, or drop — and reports when a resync request is warranted.
//!
//! Trust note: on non-org groups the control channel is unauthenticated
//! (org groups gain the signed envelope in ADR 0007). Forged commits are
//! harmless to correctness — they never apply (they fail `process_commit`,
//! and the caller confirms into `applied` ONLY after a successful apply, so
//! garbage never poisons the dedup set). The buffer is bounded and keeps the
//! first entry per epoch so garbage cannot evict a genuine buffered commit.
//! Org groups later add a roster-version trigger on the same buffer
//! (ADR 0005); keep this module org-agnostic.

use std::collections::{BTreeMap, HashSet};

/// Bounds memory against a peer spamming distinct future-epoch blobs.
/// Membership commits are rare, so a real backlog never approaches this.
const BUFFER_CAP: usize = 64;

#[derive(Debug, PartialEq)]
pub enum Disposition {
    /// Commit is for the current epoch — process it now, then `confirm`.
    Apply,
    /// Future epoch — held in the buffer; caller should check `gap`.
    Buffered,
    /// Duplicate of an applied commit, or stale epoch — drop silently.
    AlreadySeen,
}

#[derive(Default)]
pub struct CommitSequencer {
    /// b64 of commits that were SUCCESSFULLY applied (or absorbed via a
    /// Welcome). Never populated by unapplied/failed commits, so a transient
    /// apply failure or forged blob cannot poison future delivery.
    applied: HashSet<String>,
    /// Future commits by wire epoch; first-writer-wins per epoch.
    buffered: BTreeMap<u64, String>,
    last_requested_epoch: Option<u64>,
}

impl CommitSequencer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn offer(
        &mut self,
        current_epoch: u64,
        commit_epoch: u64,
        commit_b64: &str,
    ) -> Disposition {
        if self.applied.contains(commit_b64) {
            return Disposition::AlreadySeen;
        }
        match commit_epoch.cmp(&current_epoch) {
            // Stale: already applied in a past epoch, or a replay. The epoch
            // guard catches every re-offer, so we need not remember it.
            std::cmp::Ordering::Less => Disposition::AlreadySeen,
            // The caller applies, then calls `confirm` on success.
            std::cmp::Ordering::Equal => Disposition::Apply,
            std::cmp::Ordering::Greater => {
                // Keep the first entry per epoch (a genuine commit already
                // buffered must not be evicted by later garbage), and stop
                // growing past the cap.
                if !self.buffered.contains_key(&commit_epoch) && self.buffered.len() < BUFFER_CAP {
                    self.buffered.insert(commit_epoch, commit_b64.to_string());
                }
                Disposition::Buffered
            }
        }
    }

    /// Record a commit as applied. Call after a successful `process_commit`,
    /// or for a Welcome-carried admission commit that is already merged.
    pub fn confirm(&mut self, commit_b64: String) {
        self.applied.insert(commit_b64);
    }

    /// Alias for `confirm`, named for the Welcome path where the commit was
    /// absorbed out of band rather than applied here.
    pub fn mark_seen(&mut self, commit_b64: String) {
        self.confirm(commit_b64);
    }

    /// Pop the buffered commit applicable at `current_epoch`, if any. Callers
    /// loop: apply -> confirm -> epoch advanced -> call again.
    pub fn drain_ready(&mut self, current_epoch: u64) -> Option<String> {
        self.buffered.remove(&current_epoch)
    }

    /// A buffered commit exists that cannot be applied yet — commits between
    /// `current_epoch` and the buffered head are missing.
    pub fn gap(&self, current_epoch: u64) -> bool {
        self.buffered
            .keys()
            .next()
            .is_some_and(|head| *head > current_epoch)
    }

    /// True once per distinct stuck epoch: dedups resync requests while no
    /// progress is made, re-arms as soon as the epoch moves. Call only when a
    /// request is actually about to be sent (see `rearm`).
    pub fn should_request(&mut self, have_epoch: u64) -> bool {
        if self.last_requested_epoch == Some(have_epoch) {
            return false;
        }
        self.last_requested_epoch = Some(have_epoch);
        true
    }

    /// Undo a `should_request` reservation (e.g. the publish failed) so the
    /// next gap sighting retries instead of going silent until restart.
    pub fn rearm(&mut self) {
        self.last_requested_epoch = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_epoch_applies_only_after_confirm() {
        let mut s = CommitSequencer::new();
        assert_eq!(s.offer(5, 5, "c5"), Disposition::Apply);
        // Not yet confirmed: a redelivery at the SAME epoch still says Apply
        // (idempotent — caller re-applies only if its own epoch didn't move).
        assert_eq!(s.offer(5, 5, "c5"), Disposition::Apply);
        s.confirm("c5".into());
        assert_eq!(s.offer(5, 5, "c5"), Disposition::AlreadySeen);
    }

    #[test]
    fn failed_apply_does_not_poison() {
        // Regression guard: a commit that was offered but never confirmed
        // (apply failed) must still be applicable on redelivery.
        let mut s = CommitSequencer::new();
        assert_eq!(s.offer(3, 3, "cX"), Disposition::Apply);
        // apply failed -> no confirm
        assert_eq!(s.offer(3, 3, "cX"), Disposition::Apply);
    }

    #[test]
    fn stale_dropped() {
        let mut s = CommitSequencer::new();
        assert_eq!(s.offer(6, 4, "old"), Disposition::AlreadySeen);
    }

    #[test]
    fn future_commits_buffer_and_drain_in_order() {
        let mut s = CommitSequencer::new();
        assert_eq!(s.offer(5, 7, "c7"), Disposition::Buffered);
        assert_eq!(s.offer(5, 6, "c6"), Disposition::Buffered);
        assert_eq!(s.offer(5, 5, "c5"), Disposition::Apply);
        s.confirm("c5".into());
        assert_eq!(s.drain_ready(6).as_deref(), Some("c6"));
        s.confirm("c6".into());
        assert_eq!(s.drain_ready(7).as_deref(), Some("c7"));
        assert_eq!(s.drain_ready(8), None);
    }

    #[test]
    fn buffer_keeps_first_entry_per_epoch() {
        let mut s = CommitSequencer::new();
        assert_eq!(s.offer(5, 6, "real"), Disposition::Buffered);
        assert_eq!(s.offer(5, 6, "garbage"), Disposition::Buffered);
        assert_eq!(s.drain_ready(6).as_deref(), Some("real"));
    }

    #[test]
    fn buffer_is_bounded() {
        let mut s = CommitSequencer::new();
        for e in 0..(BUFFER_CAP as u64 + 50) {
            s.offer(0, e + 1, &format!("c{e}"));
        }
        assert!(s.buffered.len() <= BUFFER_CAP);
    }

    #[test]
    fn gap_reported_only_while_head_unreachable() {
        let mut s = CommitSequencer::new();
        assert!(!s.gap(5));
        s.offer(5, 7, "c7");
        assert!(s.gap(5));
        assert!(!s.gap(7));
    }

    #[test]
    fn should_request_fires_once_and_rearm_retries() {
        let mut s = CommitSequencer::new();
        assert!(s.should_request(5));
        assert!(!s.should_request(5));
        s.rearm();
        assert!(s.should_request(5)); // retried after a failed publish
        assert!(s.should_request(6)); // progress re-arms naturally
    }

    #[test]
    fn mark_seen_makes_gossip_redelivery_a_duplicate() {
        let mut s = CommitSequencer::new();
        s.mark_seen("welcome-commit".into());
        assert_eq!(s.offer(1, 1, "welcome-commit"), Disposition::AlreadySeen);
    }
}

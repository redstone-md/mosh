//! Epoch-ordered admission of MLS commits for group runtimes.
//!
//! Gossip gives no ordering guarantee: a member can receive the commit for
//! epoch N+1 before N, or the same commit twice. Applying out of order
//! errors inside OpenMLS and previously desynced the member permanently.
//! The sequencer decides, per incoming commit, whether to apply now, hold
//! for later, or drop — and reports when a resync request is warranted.
//! Org groups later add a roster-version trigger on the same buffer
//! (ADR 0005); keep this module org-agnostic.

use std::collections::{BTreeMap, HashSet};

#[derive(Debug, PartialEq)]
pub enum Disposition {
    /// Commit is for the current epoch — process it now.
    Apply,
    /// Future epoch — held in the buffer; caller should check `gap`.
    Buffered,
    /// Duplicate bytes or stale epoch — drop silently.
    AlreadySeen,
}

#[derive(Default)]
pub struct CommitSequencer {
    seen: HashSet<String>,
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
        if self.seen.contains(commit_b64) {
            return Disposition::AlreadySeen;
        }
        self.seen.insert(commit_b64.to_string());
        match commit_epoch.cmp(&current_epoch) {
            std::cmp::Ordering::Less => Disposition::AlreadySeen,
            std::cmp::Ordering::Equal => Disposition::Apply,
            std::cmp::Ordering::Greater => {
                self.buffered.insert(commit_epoch, commit_b64.to_string());
                Disposition::Buffered
            }
        }
    }

    /// Record a commit absorbed out of band (e.g. carried by a Welcome) so a
    /// later gossip re-delivery is treated as a duplicate.
    pub fn mark_seen(&mut self, commit_b64: String) {
        self.seen.insert(commit_b64);
    }

    /// Pop the buffered commit applicable at `current_epoch`, if any. Callers
    /// loop: apply -> epoch advanced -> call again.
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
    /// progress is made, re-arms as soon as the epoch moves.
    pub fn should_request(&mut self, have_epoch: u64) -> bool {
        if self.last_requested_epoch == Some(have_epoch) {
            return false;
        }
        self.last_requested_epoch = Some(have_epoch);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_epoch_applies() {
        let mut s = CommitSequencer::new();
        assert_eq!(s.offer(5, 5, "c5"), Disposition::Apply);
    }

    #[test]
    fn duplicate_and_stale_dropped() {
        let mut s = CommitSequencer::new();
        assert_eq!(s.offer(5, 5, "c5"), Disposition::Apply);
        assert_eq!(s.offer(6, 5, "c5"), Disposition::AlreadySeen); // dup bytes
        assert_eq!(s.offer(6, 4, "old"), Disposition::AlreadySeen); // stale epoch
    }

    #[test]
    fn future_commits_buffer_and_drain_in_order() {
        let mut s = CommitSequencer::new();
        assert_eq!(s.offer(5, 7, "c7"), Disposition::Buffered);
        assert_eq!(s.offer(5, 6, "c6"), Disposition::Buffered);
        // Missing c5 arrives, applied externally; epoch is now 6.
        assert_eq!(s.offer(5, 5, "c5"), Disposition::Apply);
        assert_eq!(s.drain_ready(6).as_deref(), Some("c6"));
        assert_eq!(s.drain_ready(7).as_deref(), Some("c7"));
        assert_eq!(s.drain_ready(8), None);
    }

    #[test]
    fn gap_reported_only_while_head_unreachable() {
        let mut s = CommitSequencer::new();
        assert!(!s.gap(5));
        s.offer(5, 7, "c7");
        assert!(s.gap(5)); // 5..7 missing
        assert!(!s.gap(7)); // head is applicable now
    }

    #[test]
    fn should_request_fires_once_per_stuck_epoch() {
        let mut s = CommitSequencer::new();
        assert!(s.should_request(5));
        assert!(!s.should_request(5)); // still stuck, no re-spam
        assert!(s.should_request(6)); // progress -> re-armed
        assert!(s.should_request(5)); // regressed/new stall at old epoch
    }

    #[test]
    fn mark_seen_makes_gossip_redelivery_a_duplicate() {
        let mut s = CommitSequencer::new();
        s.mark_seen("welcome-commit".into());
        assert_eq!(s.offer(1, 1, "welcome-commit"), Disposition::AlreadySeen);
    }
}

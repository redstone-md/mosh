//! The one moss node this process runs, and the refcount that keeps it up.
//!
//! Node identity is per process (the keystore is a process global), so N nodes
//! mean the SAME peer id announced from N ports. A remote peer keeps one
//! session per identity: it closes the rest the moment they arrive and declines
//! to dial the others at all, because it already holds that id. Measured across
//! three clients over three days: 33,715 sessions, 32,330 dead inside a second,
//! one identity on 27 different ports within an hour.
//!
//! Every conversation — DM, public channel, private group, org control — now
//! shares this node and separates itself by room (moss >= v0.8.19). A joined
//! room is byte-identical to a room the node was born in, so a consolidated
//! client still talks to every already-released one.
//!
//! The relay node is deliberately NOT here: it lives in its own mesh with its
//! own callbacks and send worker, and there is only ever one of it.

use std::sync::{Arc, Mutex};

use crate::moss_ffi::{clear_event_log, MossFfiError, MossFfiRuntime, MossNode, MossNodeConfig};

/// The room the shared node is born in. Carries no conversation traffic — each
/// conversation publishes in its own room — but a node must be born in some
/// room. Kept at the value DM nodes have used since v0.7.3 so the substrate a
/// released client sees does not move.
pub const SUBSTRATE_ROOM: &str = "mosh-dm/1";

#[derive(Debug)]
pub enum SharedNodeError {
    Moss(MossFfiError),
    /// The node was up a moment ago and is not now — only reachable if a
    /// release raced an acquire, which the mutex prevents. Kept explicit so the
    /// caller gets a message instead of a panic.
    Missing,
}

impl std::fmt::Display for SharedNodeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Moss(error) => write!(formatter, "{error}"),
            Self::Missing => write!(formatter, "shared moss node missing"),
        }
    }
}

impl std::error::Error for SharedNodeError {}

impl From<MossFfiError> for SharedNodeError {
    fn from(error: MossFfiError) -> Self {
        Self::Moss(error)
    }
}

struct SharedNodeState {
    node: Option<Arc<MossNode>>,
    refs: usize,
}

pub struct SharedMossNode {
    moss: Arc<MossFfiRuntime>,
    state: Mutex<SharedNodeState>,
}

impl SharedMossNode {
    pub fn new(moss: Arc<MossFfiRuntime>) -> Arc<Self> {
        Arc::new(Self {
            moss,
            state: Mutex::new(SharedNodeState {
                node: None,
                refs: 0,
            }),
        })
    }

    pub fn moss(&self) -> &Arc<MossFfiRuntime> {
        &self.moss
    }

    /// Bring the node up on first demand and take a reference to it; later
    /// callers bump the count and get the same handle.
    ///
    /// The node is born once, with the first caller's port — a later
    /// conversation only contributes its `static_peer`, which is dialled
    /// because the node is already listening. Start BEFORE bumping the count,
    /// or a transient init failure leaks a reference that can never be
    /// released.
    pub fn acquire(
        &self,
        listen_port: u16,
        static_peer: Option<String>,
    ) -> Result<Arc<MossNode>, SharedNodeError> {
        let mut state = self.lock();
        match state.node.as_ref() {
            None => {
                let node = start_node(&self.moss, listen_port, static_peer)?;
                state.node = Some(Arc::new(node));
            }
            Some(node) => {
                if let Some(peer) = static_peer.as_deref() {
                    if let Err(error) = node.connect(peer) {
                        eprintln!("shared moss node could not dial {peer}: {error}");
                    }
                }
            }
        }
        state.refs += 1;
        state.node.clone().ok_or(SharedNodeError::Missing)
    }

    /// Drop a reference. The last one stops moss (MossNode::drop → Moss_Stop).
    /// Callers must unsubscribe and leave their room first — on a shared node
    /// dropping the handle no longer ends a conversation's subscriptions.
    pub fn release(&self) {
        drop_ref(&mut self.lock());
    }

    /// The node if it is up, without taking a reference. For diagnostics.
    pub fn current(&self) -> Option<Arc<MossNode>> {
        self.lock().node.clone()
    }

    /// A poisoned lock means a panic while the node was being swapped. The
    /// state behind it is still structurally sound (an Option and a counter),
    /// so recovering beats propagating a panic into every conversation.
    fn lock(&self) -> std::sync::MutexGuard<'_, SharedNodeState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

/// Drop one reference, forgetting the node when the last holder lets go.
/// Split out so the refcount can be tested without a moss library to start a
/// node with.
fn drop_ref(state: &mut SharedNodeState) {
    state.refs = state.refs.saturating_sub(1);
    if state.refs == 0 {
        state.node = None;
    }
}

fn start_node(
    moss: &Arc<MossFfiRuntime>,
    listen_port: u16,
    static_peer: Option<String>,
) -> Result<MossNode, MossFfiError> {
    let node = moss.init_default_node(
        SUBSTRATE_ROOM,
        &MossNodeConfig {
            listen_port,
            static_peer,
            bind_interface: None,
        },
    )?;
    node.set_message_callback()?;
    node.set_event_callback()?;
    clear_event_log();
    node.start()?;
    Ok(node)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Refcounting is the whole contract: the node stays up until the last
    /// holder lets go, and a stray extra release must not underflow the count
    /// into "never stops again".
    #[test]
    fn node_survives_every_release_but_the_last() {
        let mut state = SharedNodeState {
            node: None,
            refs: 2,
        };

        drop_ref(&mut state);
        assert_eq!(state.refs, 1, "one holder left, node must stay up");

        drop_ref(&mut state);
        assert_eq!(state.refs, 0, "last release stops the node");

        drop_ref(&mut state);
        assert_eq!(state.refs, 0, "releasing past zero saturates");
    }
}

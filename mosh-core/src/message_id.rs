use std::cell::Cell;

/// Per-session message-id generator: `{sent_at_ms}-{monotonic seq}`. The seq
/// never repeats within a process run, unlike `messages.len()` (which stays
/// flat when `upsert` replaces a message), so two messages stamped in the same
/// millisecond can't collide and overwrite each other. `Cell` keeps the
/// stamping path `&self`; access is always serialized behind the runtime mutex.
#[derive(Default)]
pub struct MessageIdGen {
    seq: Cell<u64>,
}

impl MessageIdGen {
    pub fn next(&self, sent_at_ms: u64) -> String {
        let seq = self.seq.get();
        self.seq.set(seq + 1);
        format!("{sent_at_ms}-{seq:06}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_within_the_same_millisecond() {
        let gen = MessageIdGen::default();
        let a = gen.next(1000);
        let b = gen.next(1000);
        let c = gen.next(1000);
        assert_eq!(a, "1000-000000");
        assert_eq!(b, "1000-000001");
        assert_eq!(c, "1000-000002");
        assert_ne!(a, b);
    }

    #[test]
    fn seq_keeps_climbing_across_timestamps() {
        let gen = MessageIdGen::default();
        assert_eq!(gen.next(1000), "1000-000000");
        // A new millisecond does not reset the counter, so an id can never be
        // reused even if the clock repeats a value.
        assert_eq!(gen.next(2000), "2000-000001");
    }
}

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::adapters::attachment_crypto::{
    decrypt_chunk, encrypt_chunk, random_key, random_nonce_prefix, sha256_hex,
    AttachmentCryptoError, ATTACHMENT_KEY_LEN, ATTACHMENT_NONCE_PREFIX_LEN,
};

// Moss caps a gossipsub payload at 64KB. A plaintext chunk grows by the
// 16-byte GCM tag, then ~33% for base64, then the JSON envelope, so the
// plaintext chunk must stay well under the cap to survive the round trip.
pub const CHUNK_SIZE: u32 = 32 * 1024;
pub const MAX_ATTACHMENT_SIZE: u64 = 50 * 1024 * 1024;
const MAX_REQUEST_BATCH: usize = 64;

#[derive(Debug)]
pub enum AttachmentRuntimeError {
    TooLarge { size: u64 },
    Empty,
    Crypto(String),
    UnknownTransfer(String),
    DuplicateTransfer(String),
    ManifestMismatch(String),
    Codec(String),
}

impl std::fmt::Display for AttachmentRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLarge { size } => write!(
                formatter,
                "attachment of {size} bytes exceeds the {MAX_ATTACHMENT_SIZE}-byte limit"
            ),
            Self::Empty => write!(formatter, "attachment is empty"),
            Self::Crypto(error) => write!(formatter, "attachment crypto: {error}"),
            Self::UnknownTransfer(id) => write!(formatter, "unknown attachment transfer: {id}"),
            Self::DuplicateTransfer(id) => {
                write!(formatter, "attachment transfer already registered: {id}")
            }
            Self::ManifestMismatch(detail) => {
                write!(formatter, "attachment manifest invalid: {detail}")
            }
            Self::Codec(error) => write!(formatter, "attachment codec: {error}"),
        }
    }
}

impl std::error::Error for AttachmentRuntimeError {}

impl From<AttachmentCryptoError> for AttachmentRuntimeError {
    fn from(error: AttachmentCryptoError) -> Self {
        Self::Crypto(error.to_string())
    }
}

/// Carries the secret material and metadata for one attachment. Hosts send
/// this over their confidential control path (MLS-encrypted for DM and
/// groups, plaintext broadcast for public channels).
/// Voice-message metadata carried alongside an audio attachment. Its presence
/// is the sole marker that an attachment is a recorded voice message rather
/// than a user-picked audio file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceMeta {
    /// Recording length in milliseconds.
    pub duration_ms: u32,
    /// 64 amplitude buckets (one byte each, 0-255), base64-encoded.
    pub peaks_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentManifest {
    pub attachment_id: String,
    pub content_hash: String,
    pub file_name: String,
    pub mime: String,
    pub total_size: u64,
    pub chunk_size: u32,
    pub chunk_count: u64,
    pub key_b64: String,
    pub nonce_prefix_b64: String,
    pub thumbnail_b64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<VoiceMeta>,
    pub from_fingerprint: String,
}

/// Receiver -> sender: asks for a batch of chunk indices. Plain metadata, so
/// it can ride the dedicated blob channel without extra protection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkRequest {
    pub attachment_id: String,
    pub chunk_indices: Vec<u64>,
}

/// Sender -> receiver: one AES-GCM encrypted chunk on the blob channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkFrame {
    pub attachment_id: String,
    pub chunk_index: u64,
    pub ciphertext_b64: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferState {
    Active,
    Complete,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransferProgress {
    pub attachment_id: String,
    pub file_name: String,
    pub total_size: u64,
    pub chunk_count: u64,
    pub completed_chunks: u64,
    pub state: TransferState,
}

#[derive(Debug)]
pub enum ChunkOutcome {
    Progress(TransferProgress),
    Complete {
        attachment_id: String,
        content_hash: String,
        bytes: Vec<u8>,
    },
    Duplicate,
    Unknown,
}

struct OutgoingTransfer {
    manifest: AttachmentManifest,
    plaintext: Vec<u8>,
    key: [u8; ATTACHMENT_KEY_LEN],
    nonce_prefix: [u8; ATTACHMENT_NONCE_PREFIX_LEN],
    served_chunks: BTreeMap<u64, ()>,
    state: TransferState,
}

struct IncomingTransfer {
    manifest: AttachmentManifest,
    key: [u8; ATTACHMENT_KEY_LEN],
    nonce_prefix: [u8; ATTACHMENT_NONCE_PREFIX_LEN],
    chunks: BTreeMap<u64, Vec<u8>>,
    state: TransferState,
    download_started: bool,
    request_cursor: u64,
    /// When a streaming player asks for bytes the receiver does not have
    /// yet, this chunk index is fetched ahead of the sequential cursor.
    priority_chunk: Option<u64>,
}

/// Result of asking an incoming transfer for a byte range.
#[derive(Debug)]
pub enum StreamRange {
    /// Every covering chunk is present; the decrypted slice is returned.
    Ready {
        bytes: Vec<u8>,
        total_size: u64,
        mime: String,
    },
    /// Some covering chunk is still missing; the download was nudged
    /// toward it.
    Pending {
        total_size: u64,
    },
    Unknown,
}

pub struct AttachmentRuntime {
    outgoing: HashMap<String, OutgoingTransfer>,
    incoming: HashMap<String, IncomingTransfer>,
}

impl AttachmentRuntime {
    pub fn new() -> Self {
        Self {
            outgoing: HashMap::new(),
            incoming: HashMap::new(),
        }
    }

    /// Registers a file for sending and returns the manifest the host must
    /// deliver over its control path. The plaintext is kept in memory so the
    /// runtime can answer chunk requests on demand.
    pub fn prepare_outgoing(
        &mut self,
        attachment_id: String,
        file_name: String,
        mime: String,
        from_fingerprint: String,
        bytes: Vec<u8>,
        thumbnail_b64: Option<String>,
        voice: Option<VoiceMeta>,
    ) -> Result<AttachmentManifest, AttachmentRuntimeError> {
        if bytes.is_empty() {
            return Err(AttachmentRuntimeError::Empty);
        }
        let total_size = bytes.len() as u64;
        if total_size > MAX_ATTACHMENT_SIZE {
            return Err(AttachmentRuntimeError::TooLarge { size: total_size });
        }
        if self.outgoing.contains_key(&attachment_id) {
            return Err(AttachmentRuntimeError::DuplicateTransfer(attachment_id));
        }
        let key = random_key();
        let nonce_prefix = random_nonce_prefix();
        let chunk_count = total_size.div_ceil(u64::from(CHUNK_SIZE));
        let manifest = AttachmentManifest {
            attachment_id: attachment_id.clone(),
            content_hash: sha256_hex(&bytes),
            file_name,
            mime,
            total_size,
            chunk_size: CHUNK_SIZE,
            chunk_count,
            key_b64: encode(&key),
            nonce_prefix_b64: encode(&nonce_prefix),
            thumbnail_b64,
            voice,
            from_fingerprint,
        };
        self.outgoing.insert(
            attachment_id,
            OutgoingTransfer {
                manifest: manifest.clone(),
                plaintext: bytes,
                key,
                nonce_prefix,
                served_chunks: BTreeMap::new(),
                state: TransferState::Active,
            },
        );
        Ok(manifest)
    }

    /// Encrypts and returns the requested chunks. Indices outside the file or
    /// belonging to a cancelled transfer are skipped.
    pub fn serve_chunks(
        &mut self,
        request: &ChunkRequest,
    ) -> Result<Vec<ChunkFrame>, AttachmentRuntimeError> {
        let transfer = self
            .outgoing
            .get_mut(&request.attachment_id)
            .ok_or_else(|| {
                AttachmentRuntimeError::UnknownTransfer(request.attachment_id.clone())
            })?;
        if transfer.state != TransferState::Active {
            return Ok(Vec::new());
        }
        let mut frames = Vec::new();
        for &index in request.chunk_indices.iter().take(MAX_REQUEST_BATCH) {
            let Some(slice) = chunk_slice(&transfer.plaintext, index) else {
                continue;
            };
            let ciphertext = encrypt_chunk(&transfer.key, &transfer.nonce_prefix, index, slice)?;
            transfer.served_chunks.insert(index, ());
            frames.push(ChunkFrame {
                attachment_id: request.attachment_id.clone(),
                chunk_index: index,
                ciphertext_b64: encode(&ciphertext),
            });
        }
        // The outgoing transfer is never auto-completed: there is no receiver
        // ack, so it must stay Active to keep re-serving chunks that were
        // dropped in transit. It is dropped when the host session closes.
        Ok(frames)
    }

    /// Records an inbound manifest so the host can later request its chunks.
    pub fn register_incoming(
        &mut self,
        manifest: AttachmentManifest,
    ) -> Result<(), AttachmentRuntimeError> {
        if self.incoming.contains_key(&manifest.attachment_id) {
            return Err(AttachmentRuntimeError::DuplicateTransfer(
                manifest.attachment_id,
            ));
        }
        let key = decode_fixed::<ATTACHMENT_KEY_LEN>(&manifest.key_b64)
            .ok_or_else(|| AttachmentRuntimeError::ManifestMismatch("key".to_string()))?;
        let nonce_prefix = decode_fixed::<ATTACHMENT_NONCE_PREFIX_LEN>(&manifest.nonce_prefix_b64)
            .ok_or_else(|| AttachmentRuntimeError::ManifestMismatch("nonce prefix".to_string()))?;
        if manifest.chunk_size == 0 || manifest.total_size > MAX_ATTACHMENT_SIZE {
            return Err(AttachmentRuntimeError::ManifestMismatch(
                "size or chunk_size".to_string(),
            ));
        }
        let expected_count = manifest.total_size.div_ceil(u64::from(manifest.chunk_size));
        if expected_count != manifest.chunk_count {
            return Err(AttachmentRuntimeError::ManifestMismatch(
                "chunk_count".to_string(),
            ));
        }
        self.incoming.insert(
            manifest.attachment_id.clone(),
            IncomingTransfer {
                manifest,
                key,
                nonce_prefix,
                chunks: BTreeMap::new(),
                state: TransferState::Active,
                download_started: false,
                request_cursor: 0,
                priority_chunk: None,
            },
        );
        Ok(())
    }

    /// Returns decrypted bytes for [start, end) when every covering chunk is
    /// in. Otherwise records a priority so the missing region is fetched
    /// ahead of the sequential cursor and reports Pending.
    pub fn stream_range(&mut self, attachment_id: &str, start: u64, end: u64) -> StreamRange {
        let Some(transfer) = self.incoming.get_mut(attachment_id) else {
            return StreamRange::Unknown;
        };
        transfer.download_started = true;
        let total = transfer.manifest.total_size;
        let mime = transfer.manifest.mime.clone();
        if total == 0 || start >= total {
            return StreamRange::Ready {
                bytes: Vec::new(),
                total_size: total,
                mime,
            };
        }
        let end = end.min(total).max(start);
        let chunk = u64::from(transfer.manifest.chunk_size);
        let first = start / chunk;
        let last = if end > start {
            (end - 1) / chunk
        } else {
            first
        };

        let mut missing = None;
        for index in first..=last {
            if !transfer.chunks.contains_key(&index) {
                missing = Some(index);
                break;
            }
        }
        if let Some(index) = missing {
            transfer.priority_chunk = Some(index);
            return StreamRange::Pending { total_size: total };
        }

        let mut assembled = Vec::new();
        for index in first..=last {
            assembled.extend_from_slice(&transfer.chunks[&index]);
        }
        let offset = (start - first * chunk) as usize;
        let span = (end - start) as usize;
        let slice = assembled
            .get(offset..(offset + span).min(assembled.len()))
            .unwrap_or(&[])
            .to_vec();
        StreamRange::Ready {
            bytes: slice,
            total_size: total,
            mime,
        }
    }

    /// Marks an incoming transfer as actively downloading. Until this is
    /// called the receiver only holds the manifest (manual-download model).
    pub fn start_download(&mut self, attachment_id: &str) -> Result<(), AttachmentRuntimeError> {
        let transfer = self
            .incoming
            .get_mut(attachment_id)
            .ok_or_else(|| AttachmentRuntimeError::UnknownTransfer(attachment_id.to_string()))?;
        transfer.download_started = true;
        Ok(())
    }

    /// Returns the next chunk request the receiver should publish, or None
    /// when the transfer is idle, finished, or fully in flight. Gaps below
    /// the sliding cursor are re-requested first so a dropped connection
    /// resumes; otherwise the cursor advances by one window.
    pub fn next_chunk_request(&mut self, attachment_id: &str) -> Option<ChunkRequest> {
        let transfer = self.incoming.get_mut(attachment_id)?;
        if !transfer.download_started || transfer.state != TransferState::Active {
            return None;
        }
        let mut indices = Vec::new();
        // A streaming player's requested region jumps the queue so playback
        // is not blocked behind the sequential cursor.
        if let Some(priority) = transfer.priority_chunk {
            for index in priority..transfer.manifest.chunk_count {
                if !transfer.chunks.contains_key(&index) {
                    indices.push(index);
                    if indices.len() >= MAX_REQUEST_BATCH {
                        break;
                    }
                }
            }
            if indices.is_empty() {
                transfer.priority_chunk = None;
            } else {
                return Some(ChunkRequest {
                    attachment_id: attachment_id.to_string(),
                    chunk_indices: indices,
                });
            }
        }
        for index in 0..transfer.request_cursor {
            if !transfer.chunks.contains_key(&index) {
                indices.push(index);
                if indices.len() >= MAX_REQUEST_BATCH {
                    break;
                }
            }
        }
        if indices.is_empty() {
            while transfer.request_cursor < transfer.manifest.chunk_count
                && indices.len() < MAX_REQUEST_BATCH
            {
                indices.push(transfer.request_cursor);
                transfer.request_cursor += 1;
            }
        }
        if indices.is_empty() {
            return None;
        }
        Some(ChunkRequest {
            attachment_id: attachment_id.to_string(),
            chunk_indices: indices,
        })
    }

    /// Returns the next batch of chunk indices the receiver still needs.
    pub fn pending_chunk_indices(
        &self,
        attachment_id: &str,
    ) -> Result<Vec<u64>, AttachmentRuntimeError> {
        let transfer = self
            .incoming
            .get(attachment_id)
            .ok_or_else(|| AttachmentRuntimeError::UnknownTransfer(attachment_id.to_string()))?;
        if transfer.state != TransferState::Active {
            return Ok(Vec::new());
        }
        let mut pending = Vec::new();
        for index in 0..transfer.manifest.chunk_count {
            if !transfer.chunks.contains_key(&index) {
                pending.push(index);
                if pending.len() >= MAX_REQUEST_BATCH {
                    break;
                }
            }
        }
        Ok(pending)
    }

    /// Decrypts and stores one chunk. Once every chunk has arrived the
    /// reassembled bytes are verified against the manifest content hash.
    pub fn ingest_chunk(
        &mut self,
        frame: &ChunkFrame,
    ) -> Result<ChunkOutcome, AttachmentRuntimeError> {
        let Some(transfer) = self.incoming.get_mut(&frame.attachment_id) else {
            return Ok(ChunkOutcome::Unknown);
        };
        if transfer.state != TransferState::Active {
            return Ok(ChunkOutcome::Duplicate);
        }
        if frame.chunk_index >= transfer.manifest.chunk_count {
            return Ok(ChunkOutcome::Unknown);
        }
        if transfer.chunks.contains_key(&frame.chunk_index) {
            return Ok(ChunkOutcome::Duplicate);
        }
        let ciphertext = decode(&frame.ciphertext_b64)
            .ok_or_else(|| AttachmentRuntimeError::Codec("chunk base64".to_string()))?;
        let plaintext = decrypt_chunk(
            &transfer.key,
            &transfer.nonce_prefix,
            frame.chunk_index,
            &ciphertext,
        )?;
        transfer.chunks.insert(frame.chunk_index, plaintext);

        if transfer.chunks.len() as u64 != transfer.manifest.chunk_count {
            return Ok(ChunkOutcome::Progress(progress_of(
                &transfer.manifest,
                transfer.chunks.len() as u64,
                TransferState::Active,
            )));
        }

        let mut assembled = Vec::with_capacity(transfer.manifest.total_size as usize);
        for chunk in transfer.chunks.values() {
            assembled.extend_from_slice(chunk);
        }
        let actual_hash = sha256_hex(&assembled);
        if actual_hash != transfer.manifest.content_hash {
            transfer.state = TransferState::Failed;
            return Err(AttachmentRuntimeError::ManifestMismatch(format!(
                "content hash {actual_hash} != {}",
                transfer.manifest.content_hash
            )));
        }
        transfer.state = TransferState::Complete;
        Ok(ChunkOutcome::Complete {
            attachment_id: frame.attachment_id.clone(),
            content_hash: actual_hash,
            bytes: assembled,
        })
    }

    pub fn cancel(&mut self, attachment_id: &str) {
        if let Some(transfer) = self.outgoing.get_mut(attachment_id) {
            if transfer.state == TransferState::Active {
                transfer.state = TransferState::Cancelled;
            }
        }
        if let Some(transfer) = self.incoming.get_mut(attachment_id) {
            if transfer.state == TransferState::Active {
                transfer.state = TransferState::Cancelled;
            }
        }
    }

    pub fn forget(&mut self, attachment_id: &str) {
        self.outgoing.remove(attachment_id);
        self.incoming.remove(attachment_id);
    }

    pub fn outgoing_progress(&self, attachment_id: &str) -> Option<TransferProgress> {
        self.outgoing.get(attachment_id).map(|transfer| {
            progress_of(
                &transfer.manifest,
                transfer.served_chunks.len() as u64,
                transfer.state,
            )
        })
    }

    pub fn incoming_progress(&self, attachment_id: &str) -> Option<TransferProgress> {
        self.incoming.get(attachment_id).map(|transfer| {
            progress_of(
                &transfer.manifest,
                transfer.chunks.len() as u64,
                transfer.state,
            )
        })
    }
}

impl Default for AttachmentRuntime {
    fn default() -> Self {
        Self::new()
    }
}

fn progress_of(
    manifest: &AttachmentManifest,
    completed_chunks: u64,
    state: TransferState,
) -> TransferProgress {
    TransferProgress {
        attachment_id: manifest.attachment_id.clone(),
        file_name: manifest.file_name.clone(),
        total_size: manifest.total_size,
        chunk_count: manifest.chunk_count,
        completed_chunks,
        state,
    }
}

fn chunk_slice(plaintext: &[u8], index: u64) -> Option<&[u8]> {
    let start = index.checked_mul(u64::from(CHUNK_SIZE))? as usize;
    if start >= plaintext.len() {
        return None;
    }
    let end = (start + CHUNK_SIZE as usize).min(plaintext.len());
    Some(&plaintext[start..end])
}

fn encode(bytes: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
}

fn decode(encoded: &str) -> Option<Vec<u8>> {
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded).ok()
}

fn decode_fixed<const N: usize>(encoded: &str) -> Option<[u8; N]> {
    let bytes = decode(encoded)?;
    if bytes.len() != N {
        return None;
    }
    let mut out = [0u8; N];
    out.copy_from_slice(&bytes);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(size: usize) -> Vec<u8> {
        (0..size).map(|index| (index % 251) as u8).collect()
    }

    fn drive_transfer(bytes: Vec<u8>) -> Vec<u8> {
        let mut sender = AttachmentRuntime::new();
        let mut receiver = AttachmentRuntime::new();
        let manifest = sender
            .prepare_outgoing(
                "att-1".to_string(),
                "file.bin".to_string(),
                "application/octet-stream".to_string(),
                "AABB".to_string(),
                bytes.clone(),
                None,
                None,
            )
            .unwrap();
        receiver.register_incoming(manifest).unwrap();
        receiver.start_download("att-1").unwrap();

        for _ in 0..10_000 {
            let Some(request) = receiver.next_chunk_request("att-1") else {
                break;
            };
            let frames = sender.serve_chunks(&request).unwrap();
            assert!(!frames.is_empty());
            for frame in frames {
                match receiver.ingest_chunk(&frame).unwrap() {
                    ChunkOutcome::Complete { bytes, .. } => return bytes,
                    ChunkOutcome::Progress(_) => {}
                    other => panic!("unexpected outcome {other:?}"),
                }
            }
        }
        panic!("transfer never completed");
    }

    #[test]
    fn single_chunk_round_trip() {
        let bytes = payload(1024);
        assert_eq!(drive_transfer(bytes.clone()), bytes);
    }

    #[test]
    fn multi_chunk_round_trip() {
        let bytes = payload((CHUNK_SIZE as usize) * 3 + 17);
        assert_eq!(drive_transfer(bytes.clone()), bytes);
    }

    #[test]
    fn rejects_oversized_attachment() {
        let mut runtime = AttachmentRuntime::new();
        let huge = vec![0u8; (MAX_ATTACHMENT_SIZE + 1) as usize];
        assert!(matches!(
            runtime.prepare_outgoing(
                "x".to_string(),
                "x".to_string(),
                "x".to_string(),
                "x".to_string(),
                huge,
                None,
                None,
            ),
            Err(AttachmentRuntimeError::TooLarge { .. })
        ));
    }

    #[test]
    fn rejects_empty_attachment() {
        let mut runtime = AttachmentRuntime::new();
        assert!(matches!(
            runtime.prepare_outgoing(
                "x".to_string(),
                "x".to_string(),
                "x".to_string(),
                "x".to_string(),
                Vec::new(),
                None,
                None,
            ),
            Err(AttachmentRuntimeError::Empty)
        ));
    }

    #[test]
    fn duplicate_chunk_is_idempotent() {
        let mut sender = AttachmentRuntime::new();
        let mut receiver = AttachmentRuntime::new();
        let manifest = sender
            .prepare_outgoing(
                "a".to_string(),
                "f".to_string(),
                "m".to_string(),
                "fp".to_string(),
                payload(2048),
                None,
                None,
            )
            .unwrap();
        receiver.register_incoming(manifest).unwrap();
        let request = ChunkRequest {
            attachment_id: "a".to_string(),
            chunk_indices: vec![0],
        };
        let frames = sender.serve_chunks(&request).unwrap();
        let frame = frames.into_iter().next().unwrap();
        receiver.ingest_chunk(&frame).unwrap();
        assert!(matches!(
            receiver.ingest_chunk(&frame).unwrap(),
            ChunkOutcome::Duplicate
        ));
    }

    #[test]
    fn corrupted_chunk_is_rejected() {
        let mut sender = AttachmentRuntime::new();
        let mut receiver = AttachmentRuntime::new();
        let manifest = sender
            .prepare_outgoing(
                "a".to_string(),
                "f".to_string(),
                "m".to_string(),
                "fp".to_string(),
                payload(512),
                None,
                None,
            )
            .unwrap();
        receiver.register_incoming(manifest).unwrap();
        let request = ChunkRequest {
            attachment_id: "a".to_string(),
            chunk_indices: vec![0],
        };
        let mut frame = sender.serve_chunks(&request).unwrap().remove(0);
        frame.ciphertext_b64 = encode(b"tampered ciphertext bytes here padding");
        assert!(receiver.ingest_chunk(&frame).is_err());
    }

    #[test]
    fn cancel_stops_serving_chunks() {
        let mut sender = AttachmentRuntime::new();
        sender
            .prepare_outgoing(
                "a".to_string(),
                "f".to_string(),
                "m".to_string(),
                "fp".to_string(),
                payload(4096),
                None,
                None,
            )
            .unwrap();
        sender.cancel("a");
        let frames = sender
            .serve_chunks(&ChunkRequest {
                attachment_id: "a".to_string(),
                chunk_indices: vec![0],
            })
            .unwrap();
        assert!(frames.is_empty());
    }

    #[test]
    fn next_chunk_request_is_idle_until_download_starts() {
        let mut sender = AttachmentRuntime::new();
        let mut receiver = AttachmentRuntime::new();
        let manifest = sender
            .prepare_outgoing(
                "a".to_string(),
                "f".to_string(),
                "m".to_string(),
                "fp".to_string(),
                payload(4096),
                None,
                None,
            )
            .unwrap();
        receiver.register_incoming(manifest).unwrap();
        assert!(receiver.next_chunk_request("a").is_none());
        receiver.start_download("a").unwrap();
        assert!(receiver.next_chunk_request("a").is_some());
    }

    #[test]
    fn next_chunk_request_resumes_gaps_before_advancing() {
        let mut sender = AttachmentRuntime::new();
        let mut receiver = AttachmentRuntime::new();
        let manifest = sender
            .prepare_outgoing(
                "a".to_string(),
                "f".to_string(),
                "m".to_string(),
                "fp".to_string(),
                payload((CHUNK_SIZE as usize) * 3),
                None,
                None,
            )
            .unwrap();
        receiver.register_incoming(manifest).unwrap();
        receiver.start_download("a").unwrap();

        let first = receiver.next_chunk_request("a").unwrap();
        assert_eq!(first.chunk_indices, vec![0, 1, 2]);
        // Deliver only chunk 1, leaving 0 and 2 as gaps.
        let frames = sender
            .serve_chunks(&ChunkRequest {
                attachment_id: "a".to_string(),
                chunk_indices: vec![1],
            })
            .unwrap();
        receiver.ingest_chunk(&frames[0]).unwrap();
        let resume = receiver.next_chunk_request("a").unwrap();
        assert_eq!(resume.chunk_indices, vec![0, 2]);
    }

    #[test]
    fn stream_range_returns_pending_then_ready() {
        let mut sender = AttachmentRuntime::new();
        let mut receiver = AttachmentRuntime::new();
        let bytes = payload((CHUNK_SIZE as usize) * 3 + 40);
        let manifest = sender
            .prepare_outgoing(
                "a".to_string(),
                "v.bin".to_string(),
                "video/mp4".to_string(),
                "fp".to_string(),
                bytes.clone(),
                None,
                None,
            )
            .unwrap();
        receiver.register_incoming(manifest).unwrap();

        // Nothing downloaded yet: a range read is pending and arms a priority.
        let start = (CHUNK_SIZE as u64) * 2;
        let end = start + 100;
        assert!(matches!(
            receiver.stream_range("a", start, end),
            StreamRange::Pending { .. }
        ));
        let request = receiver.next_chunk_request("a").unwrap();
        assert_eq!(request.chunk_indices.first().copied(), Some(2));

        // Deliver every chunk, then the same range reads back exactly.
        loop {
            let Some(request) = receiver.next_chunk_request("a") else {
                break;
            };
            for frame in sender.serve_chunks(&request).unwrap() {
                let _ = receiver.ingest_chunk(&frame).unwrap();
            }
        }
        match receiver.stream_range("a", start, end) {
            StreamRange::Ready {
                bytes: slice,
                total_size,
                mime,
            } => {
                assert_eq!(total_size, bytes.len() as u64);
                assert_eq!(mime, "video/mp4");
                assert_eq!(slice, &bytes[start as usize..end as usize]);
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }

    #[test]
    fn register_incoming_rejects_bad_chunk_count() {
        let mut runtime = AttachmentRuntime::new();
        let manifest = AttachmentManifest {
            attachment_id: "a".to_string(),
            content_hash: "0".repeat(64),
            file_name: "f".to_string(),
            mime: "m".to_string(),
            total_size: 1024,
            chunk_size: CHUNK_SIZE,
            chunk_count: 99,
            key_b64: encode(&[0u8; ATTACHMENT_KEY_LEN]),
            nonce_prefix_b64: encode(&[0u8; ATTACHMENT_NONCE_PREFIX_LEN]),
            thumbnail_b64: None,
            voice: None,
            from_fingerprint: "fp".to_string(),
        };
        assert!(matches!(
            runtime.register_incoming(manifest),
            Err(AttachmentRuntimeError::ManifestMismatch(_))
        ));
    }

    #[test]
    fn prepare_outgoing_stamps_voice_onto_the_manifest() {
        let mut runtime = AttachmentRuntime::new();
        let voice = VoiceMeta {
            duration_ms: 1000,
            peaks_b64: "AAA=".to_string(),
        };
        let manifest = runtime
            .prepare_outgoing(
                "att-1".into(),
                "voice-message.webm".into(),
                "audio/webm".into(),
                "fp".into(),
                vec![1, 2, 3, 4],
                None,
                Some(voice),
            )
            .expect("prepare");
        let stamped = manifest.voice.expect("voice present");
        assert_eq!(stamped.duration_ms, 1000);
    }

    #[test]
    fn voice_meta_roundtrips_through_json() {
        let meta = VoiceMeta {
            duration_ms: 4200,
            peaks_b64: "AAECAwQF".to_string(),
        };
        let json = serde_json::to_string(&meta).expect("serialize");
        let back: VoiceMeta = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.duration_ms, 4200);
        assert_eq!(back.peaks_b64, "AAECAwQF");
    }

    #[test]
    fn manifest_without_voice_omits_the_field() {
        let manifest = AttachmentManifest {
            attachment_id: "a".into(),
            content_hash: "h".into(),
            file_name: "f".into(),
            mime: "audio/webm".into(),
            total_size: 1,
            chunk_size: 1,
            chunk_count: 1,
            key_b64: "k".into(),
            nonce_prefix_b64: "n".into(),
            thumbnail_b64: None,
            voice: None,
            from_fingerprint: "fp".into(),
        };
        let json = serde_json::to_string(&manifest).expect("serialize");
        assert!(!json.contains("voice"), "voice must be omitted when None");
    }
}

/**
 * AES-GCM frame seal / open for a 1:1 voice call. The wire frame is
 * `[seq:u64 BE][ciphertext-with-tag]`; AES-GCM nonce = `[nonce_prefix (4)] [seq (8)]`.
 * The high bit of `seq` distinguishes direction so the two participants never
 * collide nonces while sharing one key.
 */

export const CALLER_DIRECTION_BIT = 0n;
export const CALLEE_DIRECTION_BIT = 1n << 63n;
const SEQ_VALUE_MASK = (1n << 63n) - 1n;

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function bytesFromBase64(value: string): Uint8Array {
  return b64ToBytes(value);
}

export function bytesToBase64(value: Uint8Array): string {
  return bytesToB64(value);
}

export async function importCallKey(keyBase64: string): Promise<CryptoKey> {
  const raw = b64ToBytes(keyBase64);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function buildNonce(prefixBase64: string, seq: bigint): Uint8Array {
  const prefix = b64ToBytes(prefixBase64);
  if (prefix.length !== 4) {
    throw new Error("nonce prefix must be 4 bytes");
  }
  const nonce = new Uint8Array(12);
  nonce.set(prefix, 0);
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  view.setBigUint64(4, seq, false);
  return nonce;
}

function seqToBytes(seq: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, seq, false);
  return out;
}

function bytesToSeq(bytes: Uint8Array, offset: number): bigint {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, false);
}

export function buildFrame(seq: bigint, ciphertext: Uint8Array): Uint8Array {
  const header = seqToBytes(seq);
  const out = new Uint8Array(header.length + ciphertext.length);
  out.set(header, 0);
  out.set(ciphertext, header.length);
  return out;
}

export function parseFrame(
  bytes: Uint8Array,
): { seq: bigint; ciphertext: Uint8Array } | null {
  if (bytes.length < 9) {
    return null;
  }
  return {
    seq: bytesToSeq(bytes, 0),
    ciphertext: bytes.slice(8),
  };
}

export async function sealFrame(
  key: CryptoKey,
  noncePrefixBase64: string,
  seqValue: bigint,
  directionBit: bigint,
  payload: Uint8Array,
): Promise<Uint8Array> {
  const seq = (seqValue & SEQ_VALUE_MASK) | directionBit;
  const nonce = buildNonce(noncePrefixBase64, seq);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    payload,
  );
  return buildFrame(seq, new Uint8Array(cipherBuffer));
}

export async function openFrame(
  key: CryptoKey,
  noncePrefixBase64: string,
  frame: Uint8Array,
): Promise<{ seq: bigint; payload: Uint8Array } | null> {
  const parsed = parseFrame(frame);
  if (!parsed) {
    return null;
  }
  const nonce = buildNonce(noncePrefixBase64, parsed.seq);
  try {
    const buffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      parsed.ciphertext,
    );
    return { seq: parsed.seq, payload: new Uint8Array(buffer) };
  } catch {
    return null;
  }
}

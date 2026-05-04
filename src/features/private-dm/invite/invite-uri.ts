const MOSH_INVITE_PROTOCOL = "mosh:";
const INVITE_HOST = "invite";
const MESH_PARAM = "mesh";
const SESSION_PARAM = "session";
const PEER_PARAM = "peer";
const FINGERPRINT_PARAM = "fp";
const MIN_TOKEN_LENGTH = 4;
const MIN_FINGERPRINT_LENGTH = 8;
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const FINGERPRINT_PATTERN = /^[a-f0-9-]+$/i;

export type InviteParseErrorCode =
  | "invalid_url"
  | "invalid_scheme"
  | "missing_mesh"
  | "missing_session"
  | "missing_fingerprint"
  | "invalid_fingerprint";

export interface MoshInvite {
  readonly meshId: string;
  readonly sessionId: string;
  readonly peerHint: string | null;
  readonly fingerprint: string;
}

export class InviteParseError extends Error {
  constructor(readonly code: InviteParseErrorCode) {
    super(code);
    this.name = "InviteParseError";
  }
}

export function parseMoshInvite(rawInvite: string): MoshInvite {
  const url = parseUrl(rawInvite);

  if (url.protocol !== MOSH_INVITE_PROTOCOL || url.hostname !== INVITE_HOST) {
    throw new InviteParseError("invalid_scheme");
  }

  const meshId = readToken(url, MESH_PARAM, "missing_mesh");
  const sessionId = readToken(url, SESSION_PARAM, "missing_session");
  const peerHint = readOptionalToken(url, PEER_PARAM);
  const fingerprint = readFingerprint(url);

  return { meshId, sessionId, peerHint, fingerprint };
}

function parseUrl(rawInvite: string): URL {
  try {
    return new URL(rawInvite.trim());
  } catch (_error) {
    throw new InviteParseError("invalid_url");
  }
}

function readToken(url: URL, param: string, code: InviteParseErrorCode): string {
  const value = readOptionalToken(url, param);

  if (!value) {
    throw new InviteParseError(code);
  }

  return value;
}

function readOptionalToken(url: URL, param: string): string | null {
  const value = url.searchParams.get(param)?.trim() ?? "";

  if (!value) {
    return null;
  }

  return value.length >= MIN_TOKEN_LENGTH && TOKEN_PATTERN.test(value) ? value : null;
}

function readFingerprint(url: URL): string {
  const fingerprint = url.hash.replace(/^#/, "").replace(`${FINGERPRINT_PARAM}=`, "").trim();

  if (!fingerprint) {
    throw new InviteParseError("missing_fingerprint");
  }

  const normalized = fingerprint.replace(/-/g, "").toUpperCase();

  if (normalized.length < MIN_FINGERPRINT_LENGTH || !FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new InviteParseError("invalid_fingerprint");
  }

  return normalized;
}

import {
  InviteParseError,
  type InviteParseErrorCode,
  parseMoshGroupInvite,
  parseMoshInvite,
} from "./invite-uri";

export type InviteDetectionKind = "dm" | "group" | "org" | "empty" | "unknown";

export interface InviteDetection {
  readonly kind: InviteDetectionKind;
  readonly errorCode?: InviteParseErrorCode;
  readonly errorMessage?: string;
}

type InviteFamily = "dm" | "group" | "org" | "unknown";

export function detectInvite(value: string): InviteDetection {
  const trimmed = value.trim();
  if (!trimmed) {
    return { kind: "empty" };
  }

  const dmError = parseError(() => parseMoshInvite(trimmed));
  if (!dmError) {
    return { kind: "dm" };
  }

  const groupError = parseError(() => parseMoshGroupInvite(trimmed));
  if (!groupError) {
    return { kind: "group" };
  }

  if (isOrgBundle(trimmed)) {
    return { kind: "org" };
  }

  const family = detectInviteFamily(trimmed);
  if (family === "org") {
    return {
      kind: "unknown",
      errorMessage:
        "Organization bundle needs mesh=…, name=… and #org=<64 hex chars>.",
    };
  }
  const errorCode = family === "group" ? groupError.code : dmError.code;
  return {
    kind: "unknown",
    errorCode,
    errorMessage: inviteErrorMessage(errorCode, family),
  };
}

// Matches the Rust-side `ParsedOrgBundle::parse` contract.
function isOrgBundle(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "mosh:" || url.hostname !== "org") {
      return false;
    }
    const mesh = url.searchParams.get("mesh");
    const name = url.searchParams.get("name");
    const fragment = url.hash.startsWith("#org=") ? url.hash.slice(5) : "";
    return Boolean(mesh && name) && /^[0-9a-fA-F]{64}$/.test(fragment);
  } catch {
    return false;
  }
}

function parseError(parse: () => void): InviteParseError | null {
  try {
    parse();
    return null;
  } catch (error) {
    if (error instanceof InviteParseError) {
      return error;
    }
    return new InviteParseError("invalid_url");
  }
}

function detectInviteFamily(value: string): InviteFamily {
  try {
    const url = new URL(value);
    if (url.protocol !== "mosh:") {
      return "unknown";
    }
    if (url.hostname === "invite") {
      return "dm";
    }
    if (url.hostname === "group") {
      return "group";
    }
    if (url.hostname === "org") {
      return "org";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

function inviteErrorMessage(
  code: InviteParseErrorCode,
  family: InviteFamily,
): string {
  switch (code) {
    case "invalid_url":
      return "Paste the full mosh:// invite link.";
    case "invalid_scheme":
      return "Invite links must start with mosh://invite or mosh://group.";
    case "missing_mesh":
      return "Invite link is missing mesh=...";
    case "missing_session":
      return "Private chat invite is missing session=...";
    case "missing_group":
      return "Group invite is missing group=...";
    case "missing_fingerprint":
      return "Invite link is missing #fp=...";
    case "invalid_fingerprint":
      return family === "group"
        ? "Group fingerprint must be 32 hex characters."
        : "Fingerprint must be hex and at least 8 characters.";
  }
}

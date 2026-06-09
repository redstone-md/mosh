import {
  InviteParseError,
  type InviteParseErrorCode,
  parseMoshGroupInvite,
  parseMoshInvite,
} from "./invite-uri";

export type InviteDetectionKind = "dm" | "group" | "empty" | "unknown";

export interface InviteDetection {
  readonly kind: InviteDetectionKind;
  readonly errorCode?: InviteParseErrorCode;
  readonly errorMessage?: string;
}

type InviteFamily = "dm" | "group" | "unknown";

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

  const family = detectInviteFamily(trimmed);
  const errorCode = family === "group" ? groupError.code : dmError.code;
  return {
    kind: "unknown",
    errorCode,
    errorMessage: inviteErrorMessage(errorCode, family),
  };
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

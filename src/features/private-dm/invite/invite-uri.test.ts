import { describe, expect, it } from "vitest";
import { InviteParseError, type InviteParseErrorCode, parseMoshInvite } from "./invite-uri";

const TRACKER_INVITE = "mosh://invite?mesh=7x9v&session=drift-41#fp=91A4-D2C8-77B0";
const STATIC_PEER_INVITE = "mosh://invite?mesh=7x9v&session=drift-41&peer=alice#fp=91A4-D2C8-77B0";

describe("parseMoshInvite", () => {
  it("parses a tracker-first Mosh invite URI", () => {
    expect(parseMoshInvite(TRACKER_INVITE)).toEqual({
      meshId: "7x9v",
      sessionId: "drift-41",
      peerHint: null,
      fingerprint: "91A4D2C877B0",
    });
  });

  it("keeps optional static peer hints for fallback", () => {
    expect(parseMoshInvite(STATIC_PEER_INVITE).peerHint).toBe("alice");
  });

  const invalidInvites: ReadonlyArray<readonly [string, InviteParseErrorCode]> = [
    ["not a url", "invalid_url"],
    ["https://invite?mesh=7x9v&session=drift-41#fp=91A4-D2C8", "invalid_scheme"],
    ["mosh://invite?session=drift-41#fp=91A4-D2C8", "missing_mesh"],
    ["mosh://invite?mesh=7x9v#fp=91A4-D2C8", "missing_session"],
    ["mosh://invite?mesh=7x9v&session=drift-41", "missing_fingerprint"],
    ["mosh://invite?mesh=7x9v&session=drift-41#fp=zzzz", "invalid_fingerprint"],
  ];

  it.each(invalidInvites)("rejects %s as %s", (invite, code) => {
    expect(() => parseMoshInvite(invite)).toThrow(new InviteParseError(code));
  });
});

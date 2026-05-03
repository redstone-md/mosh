import { describe, expect, it } from "vitest";
import { InviteParseError, type InviteParseErrorCode, parseMoshInvite } from "./invite-uri";

const VALID_INVITE = "mosh://invite?mesh=7x9v&session=drift-41&peer=alice#fp=91A4-D2C8-77B0";

describe("parseMoshInvite", () => {
  it("parses a copyable Mosh invite URI", () => {
    expect(parseMoshInvite(VALID_INVITE)).toEqual({
      meshId: "7x9v",
      sessionId: "drift-41",
      peerHint: "alice",
      fingerprint: "91A4D2C877B0",
    });
  });

  const invalidInvites: ReadonlyArray<readonly [string, InviteParseErrorCode]> = [
    ["not a url", "invalid_url"],
    ["https://invite?mesh=7x9v&session=drift-41&peer=alice#fp=91A4-D2C8", "invalid_scheme"],
    ["mosh://invite?session=drift-41&peer=alice#fp=91A4-D2C8", "missing_mesh"],
    ["mosh://invite?mesh=7x9v&peer=alice#fp=91A4-D2C8", "missing_session"],
    ["mosh://invite?mesh=7x9v&session=drift-41#fp=91A4-D2C8", "missing_peer"],
    ["mosh://invite?mesh=7x9v&session=drift-41&peer=alice", "missing_fingerprint"],
    ["mosh://invite?mesh=7x9v&session=drift-41&peer=alice#fp=zzzz", "invalid_fingerprint"],
  ];

  it.each(invalidInvites)("rejects %s as %s", (invite, code) => {
    expect(() => parseMoshInvite(invite)).toThrow(new InviteParseError(code));
  });
});

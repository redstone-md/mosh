import { describe, expect, it } from "vitest";
import { detectInvite } from "./invite-detection";

const DM_INVITE = "mosh://invite?mesh=7x9v&session=drift-41#fp=91A4-D2C8-77B0";
const GROUP_INVITE =
  "mosh://group?mesh=mesh-one&group=group-one#fp=AABBCCDDEEFF00112233445566778899";

describe("detectInvite", () => {
  it("detects supported invite kinds", () => {
    expect(detectInvite(DM_INVITE)).toEqual({ kind: "dm" });
    expect(detectInvite(GROUP_INVITE)).toEqual({ kind: "group" });
  });

  it("returns a specific missing mesh message", () => {
    expect(detectInvite("mosh://invite?bad=1")).toMatchObject({
      kind: "unknown",
      errorCode: "missing_mesh",
      errorMessage: "Invite link is missing mesh=...",
    });
  });

  it("returns a group-specific fingerprint message", () => {
    expect(detectInvite("mosh://group?mesh=mesh-one&group=group-one#fp=ABCD")).toMatchObject({
      kind: "unknown",
      errorCode: "invalid_fingerprint",
      errorMessage: "Group fingerprint must be 32 hex characters.",
    });
  });
});

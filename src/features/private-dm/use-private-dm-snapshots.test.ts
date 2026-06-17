import { describe, expect, it } from "vitest";
import type { ChatTarget } from "./chat-actions";
import type { SessionSnapshot } from "./native/native-messaging-gateway";
import { nextActiveTarget } from "./use-private-dm-snapshots";

const session = (id: string) => ({ session_id: id }) as SessionSnapshot;

describe("nextActiveTarget", () => {
  it("keeps a just-created target a stale in-flight poll has not listed yet", () => {
    // User created session B (active = {dm, B}); a poll that started before B
    // existed returns only [A]. It must NOT yank the user back to A.
    const current: ChatTarget = { type: "dm", id: "B" };
    const seen = new Set(["dm:A"]); // only A was ever observed
    expect(nextActiveTarget(current, [session("A")], [], [], seen)).toEqual(current);
  });

  it("switches away from a target that was listed before and is now gone", () => {
    const current: ChatTarget = { type: "dm", id: "A" };
    const seen = new Set(["dm:A"]); // A really existed, now deleted → leave it
    expect(nextActiveTarget(current, [], [], [], seen)).toBeNull();
  });

  it("auto-selects the first session when there is no current target", () => {
    expect(nextActiveTarget(null, [session("A")], [], [], new Set())).toEqual({
      type: "dm",
      id: "A",
    });
  });

  it("keeps the current target when it is still listed", () => {
    const current: ChatTarget = { type: "dm", id: "A" };
    expect(
      nextActiveTarget(current, [session("A")], [], [], new Set(["dm:A"])),
    ).toEqual(current);
  });
});

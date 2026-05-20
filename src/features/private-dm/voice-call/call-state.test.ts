import { describe, expect, it } from "vitest";
import { NO_ANSWER_TIMEOUT_MS, hasNoAnswerTimedOut, nextCallPhase } from "./call-state";

describe("call-state", () => {
  it("idle -> outgoing on local dial", () => {
    expect(nextCallPhase("idle", { kind: "local_dial" })).toBe("outgoing");
  });

  it("ringing -> active on local accept", () => {
    expect(nextCallPhase("ringing", { kind: "local_accept" })).toBe("active");
  });

  it("outgoing -> active on remote accept", () => {
    expect(nextCallPhase("outgoing", { kind: "remote_accept" })).toBe("active");
  });

  it("any phase -> ended on local_end / remote_end / decline / no_answer", () => {
    expect(nextCallPhase("outgoing", { kind: "local_end" })).toBe("ended");
    expect(nextCallPhase("ringing", { kind: "local_decline" })).toBe("ended");
    expect(nextCallPhase("active", { kind: "remote_end" })).toBe("ended");
    expect(nextCallPhase("outgoing", { kind: "no_answer" })).toBe("ended");
  });

  it("hasNoAnswerTimedOut fires only after the timeout from dial", () => {
    const dialAt = 1_000;
    expect(hasNoAnswerTimedOut(dialAt, dialAt + NO_ANSWER_TIMEOUT_MS - 1)).toBe(false);
    expect(hasNoAnswerTimedOut(dialAt, dialAt + NO_ANSWER_TIMEOUT_MS)).toBe(true);
  });
});

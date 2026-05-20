export type CallPhase = "idle" | "outgoing" | "ringing" | "active" | "ended";

export type CallEvent =
  | { kind: "local_dial" }
  | { kind: "local_accept" }
  | { kind: "local_decline" }
  | { kind: "local_end" }
  | { kind: "remote_offer" }
  | { kind: "remote_accept" }
  | { kind: "remote_decline" }
  | { kind: "remote_end" }
  | { kind: "no_answer" };

export const NO_ANSWER_TIMEOUT_MS = 30_000;

export function nextCallPhase(phase: CallPhase, event: CallEvent): CallPhase {
  if (event.kind === "local_dial" && phase === "idle") {
    return "outgoing";
  }
  if (event.kind === "remote_offer" && phase === "idle") {
    return "ringing";
  }
  if (event.kind === "local_accept" && phase === "ringing") {
    return "active";
  }
  if (event.kind === "remote_accept" && phase === "outgoing") {
    return "active";
  }
  if (
    event.kind === "local_decline" ||
    event.kind === "local_end" ||
    event.kind === "remote_decline" ||
    event.kind === "remote_end" ||
    event.kind === "no_answer"
  ) {
    return "ended";
  }
  return phase;
}

export function hasNoAnswerTimedOut(dialAtMs: number, nowMs: number): boolean {
  return nowMs - dialAtMs >= NO_ANSWER_TIMEOUT_MS;
}

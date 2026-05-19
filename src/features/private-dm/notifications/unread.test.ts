import { describe, expect, it } from "vitest";
import { diffConversations, type ConversationCount } from "./unread";

const counts = (entries: [string, number][]): ConversationCount[] =>
  entries.map(([id, messageCount]) => ({ id, messageCount }));

describe("diffConversations", () => {
  it("reports new messages for conversations whose count grew", () => {
    const lastSeen = new Map([
      ["a", 2],
      ["b", 5],
    ]);
    const result = diffConversations(
      counts([
        ["a", 4],
        ["b", 5],
      ]),
      lastSeen,
      "b",
      false,
    );
    expect(result.newMessages).toEqual([{ id: "a", delta: 2 }]);
  });

  it("does not report the active conversation while the window is focused", () => {
    const lastSeen = new Map([["a", 1]]);
    const result = diffConversations(counts([["a", 3]]), lastSeen, "a", false);
    expect(result.newMessages).toEqual([]);
  });

  it("reports the active conversation when the window is unfocused", () => {
    const lastSeen = new Map([["a", 1]]);
    const result = diffConversations(counts([["a", 3]]), lastSeen, "a", true);
    expect(result.newMessages).toEqual([{ id: "a", delta: 2 }]);
  });

  it("treats a first-seen conversation as having no new messages", () => {
    const result = diffConversations(counts([["a", 4]]), new Map(), null, false);
    expect(result.newMessages).toEqual([]);
    expect(result.nextLastSeen.get("a")).toBe(4);
  });

  it("advances lastSeen for every conversation", () => {
    const result = diffConversations(
      counts([
        ["a", 7],
        ["b", 2],
      ]),
      new Map([["a", 3]]),
      null,
      false,
    );
    expect(result.nextLastSeen.get("a")).toBe(7);
    expect(result.nextLastSeen.get("b")).toBe(2);
  });
});

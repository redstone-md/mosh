import { describe, expect, it } from "vitest";
import {
  countMessagesFromOthers,
  diffConversations,
  notificationBody,
  type ConversationCount,
} from "./unread";

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

describe("countMessagesFromOthers", () => {
  it("ignores messages sent by the local display name", () => {
    const count = countMessagesFromOthers(
      [
        { from_device: "Alice" },
        { from_device: "Bob" },
        { from_device: "Alice" },
      ],
      "Alice",
    );

    expect(count).toBe(1);
  });

  it("counts a same-name peer's messages when fingerprints differ", () => {
    const count = countMessagesFromOthers(
      [
        { from_device: "Alice", from_fingerprint: "AAAA" }, // me
        { from_device: "Alice", from_fingerprint: "BBBB" }, // different peer, same name
      ],
      "Alice",
      "AAAA",
    );

    expect(count).toBe(1);
  });

  it("excludes own messages by fingerprint even after a display-name change", () => {
    const count = countMessagesFromOthers(
      [
        { from_device: "OldName", from_fingerprint: "AAAA" }, // me, before rename
        { from_device: "Bob", from_fingerprint: "BBBB" },
      ],
      "NewName",
      "AAAA",
    );

    expect(count).toBe(1);
  });
});

describe("notificationBody", () => {
  it("labels channel notifications with the channel name", () => {
    expect(notificationBody("channel:general")).toEqual({
      title: "Mosh",
      body: "#general - new message",
    });
  });

  it("uses a generic label for dm and group notifications", () => {
    expect(notificationBody("dm:abc")).toEqual({
      title: "Mosh",
      body: "New message - new message",
    });
  });
});

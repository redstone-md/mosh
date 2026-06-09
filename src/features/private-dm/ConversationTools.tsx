import { IconPaperclip, IconSearch, IconX } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import type { AttachmentDescriptor } from "./native/native-messaging-gateway";
import { chatText } from "./private-dm.content";

export type ConversationFilter = "all" | "attachments";

export interface ConversationToolsState {
  readonly search: string;
  readonly filter: ConversationFilter;
  readonly onSearch: (value: string) => void;
  readonly onFilter: (value: ConversationFilter) => void;
}

type SearchableMessage = {
  readonly from_device: string;
  readonly body: string;
  readonly attachment?: AttachmentDescriptor;
};

export function ConversationTools({ tools }: { tools: ConversationToolsState }) {
  return (
    <div className="conversation-tools conversation-tools-desktop">
      <label className="conversation-search">
        <IconSearch size={14} />
        <input
          aria-label={chatText.searchPlaceholder}
          value={tools.search}
          onChange={(event) => tools.onSearch(event.target.value)}
          placeholder={chatText.searchPlaceholder}
        />
      </label>
      <div className="conversation-filter" aria-label="Message filter">
        <button
          type="button"
          className={tools.filter === "all" ? "conversation-filter-active" : ""}
          onClick={() => tools.onFilter("all")}
        >
          {chatText.filterAll}
        </button>
        <button
          type="button"
          className={tools.filter === "attachments" ? "conversation-filter-active" : ""}
          onClick={() => tools.onFilter("attachments")}
        >
          <IconPaperclip size={13} />
          {chatText.filterAttachments}
        </button>
      </div>
    </div>
  );
}

export function MobileConversationSearch({
  tools,
  onClose,
}: {
  tools: ConversationToolsState;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="mobile-conversation-search">
      <label className="conversation-search">
        <IconSearch size={14} />
        <input
          ref={inputRef}
          aria-label={chatText.searchPlaceholder}
          value={tools.search}
          onChange={(event) => tools.onSearch(event.target.value)}
          placeholder={chatText.searchPlaceholder}
        />
      </label>
      <button
        className="btn btn-ghost btn-icon mobile-search-close"
        type="button"
        aria-label="Close message search"
        title="Close message search"
        onClick={() => {
          tools.onSearch("");
          onClose();
        }}
      >
        <IconX size={15} />
      </button>
    </div>
  );
}

export function MobileConversationFilterNotice({
  tools,
}: {
  tools: ConversationToolsState;
}) {
  if (tools.filter !== "attachments") {
    return null;
  }
  return (
    <div className="mobile-active-filter">
      <span>
        <IconPaperclip size={13} />
        {chatText.filterAttachments}
      </span>
      <button type="button" onClick={() => tools.onFilter("all")}>
        {chatText.filterAll}
      </button>
    </div>
  );
}

export function filterMessages<T extends SearchableMessage>(
  messages: readonly T[],
  search: string,
  filter: ConversationFilter,
): readonly T[] {
  const query = search.trim().toLowerCase();
  return messages.filter((message) => {
    if (filter === "attachments" && !message.attachment) {
      return false;
    }
    if (!query) {
      return true;
    }
    return messageSearchText(message).includes(query);
  });
}

export function SearchEmpty({ filter }: { filter: ConversationFilter }) {
  return (
    <div className="chat-empty">
      <strong>{chatText.searchEmptyTitle}</strong>
      <p>
        {filter === "attachments"
          ? chatText.attachmentEmptyBody
          : chatText.searchEmptyBody}
      </p>
    </div>
  );
}

function messageSearchText(message: SearchableMessage): string {
  return [
    message.from_device,
    message.body,
    message.attachment?.file_name,
    message.attachment?.mime,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

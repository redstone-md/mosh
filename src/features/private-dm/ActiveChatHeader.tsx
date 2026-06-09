import {
  IconMessageCircle,
  IconPaperclip,
  IconSearch,
  IconShieldCheck,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  ConversationTools,
  MobileConversationFilterNotice,
  MobileConversationSearch,
  type ConversationToolsState,
} from "./ConversationTools";
import {
  ChatHeaderMenu,
  type ChatHeaderMenuAction,
} from "./ChatHeaderMenu";
import { chatText, inviteText } from "./private-dm.content";

export function ActiveChatHeader({
  resetKey,
  leading,
  title,
  subtitle,
  tools,
  beforeSearchActions,
  afterSearchActions,
  menuActions,
  afterHeader,
}: {
  resetKey: string;
  leading: ReactNode;
  title: string;
  subtitle: ReactNode;
  tools: ConversationToolsState;
  beforeSearchActions?: ReactNode;
  afterSearchActions?: ReactNode;
  menuActions: readonly ChatHeaderMenuAction[];
  afterHeader?: ReactNode;
}) {
  const [mobileSearchOpen, setMobileSearchOpen] = useMobileSearchPanel(resetKey);
  const actions = conversationMenuActions(tools, menuActions);

  return (
    <>
      <header className="chat-header">
        {leading}
        <div className="chat-title-block">
          <h1 id="chat-title">{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="chat-header-actions">
          {beforeSearchActions}
          <MobileSearchToggle
            open={mobileSearchOpen}
            onToggle={() => setMobileSearchOpen((open) => !open)}
          />
          {afterSearchActions}
          <ChatHeaderMenu actions={actions} />
        </div>
      </header>

      {afterHeader}
      {mobileSearchOpen ? (
        <MobileConversationSearch
          tools={tools}
          onClose={() => setMobileSearchOpen(false)}
        />
      ) : null}
      <MobileConversationFilterNotice tools={tools} />
      <ConversationTools tools={tools} />
    </>
  );
}

export function FingerprintBadge({
  fingerprint,
  confirmed,
  onConfirm,
}: {
  fingerprint: string;
  confirmed: boolean;
  onConfirm: () => void;
}) {
  if (!fingerprint) {
    return null;
  }
  const display = fingerprint.match(/.{1,4}/g)?.slice(0, 4).join(" ");
  return (
    <button
      type="button"
      className={`fingerprint-badge ${confirmed ? "fingerprint-badge-confirmed" : ""}`}
      onClick={confirmed ? undefined : onConfirm}
      title={confirmed ? inviteText.confirmedButton : inviteText.fingerprintHint}
      aria-label={confirmed ? inviteText.confirmedButton : inviteText.confirmButton}
    >
      <IconShieldCheck size={12} />
      <code>{display}</code>
    </button>
  );
}

function useMobileSearchPanel(
  resetKey: string,
): [boolean, (value: boolean | ((open: boolean) => boolean)) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [resetKey]);
  return [open, setOpen];
}

function MobileSearchToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={`btn btn-ghost btn-icon chat-mobile-only${open ? " is-active" : ""}`}
      type="button"
      aria-label={open ? "Close message search" : chatText.searchPlaceholder}
      title={open ? "Close message search" : chatText.searchPlaceholder}
      onClick={onToggle}
    >
      <IconSearch size={16} />
    </button>
  );
}

function conversationMenuActions(
  tools: ConversationToolsState,
  actions: readonly ChatHeaderMenuAction[],
): readonly ChatHeaderMenuAction[] {
  const filterAction: ChatHeaderMenuAction =
    tools.filter === "attachments"
      ? {
          label: chatText.filterAll,
          icon: <IconMessageCircle size={15} />,
          onSelect: () => tools.onFilter("all"),
        }
      : {
          label: chatText.filterAttachments,
          icon: <IconPaperclip size={15} />,
          onSelect: () => tools.onFilter("attachments"),
        };
  return [filterAction, ...actions];
}

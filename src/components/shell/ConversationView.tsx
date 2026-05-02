import { useMemo, useState } from 'react'
import { BellOff, ChevronDown, ChevronUp, MonitorUp, Phone, Pin, Search, Settings2, X } from 'lucide-react'

import { formatRoomTitle } from '../../lib/chatPresentation'
import { describeArchiveStateLabel } from '../../lib/i18n'
import { focusMessageElement } from '../../lib/messageFocus'
import type { DisplayMessage } from '../../lib/messageDelivery'
import { extractPlainText } from '../../lib/messageSearch'
import type { ChannelType } from '../../lib/appShellSchemas'
import { searchMessages } from '../../lib/messageSearch'
import type { Message, PeerSummary, RoomSummary } from '../../lib/schemas'
import { useI18n } from '../I18nProvider'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { MessagePanel } from '../MessagePanel'

type ConversationViewProps = {
  room: RoomSummary | undefined
  peers: PeerSummary[]
  messages: DisplayMessage[]
  currentUser: string
  archiveFingerprint?: string
  archiveVerified?: boolean
  externalFocusMessageId?: string
  muted: boolean
  draft: string
  isSending: boolean
  mediaLive: boolean
  mediaRoomId: string | null
  channelType: ChannelType
  peerNames: string[]
  pinnedMessages: Message[]
  pinnedMessageIds: string[]
  errorNote?: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onTogglePinMessage: (messageId: string) => void
  onRetryMessage: (clientId: string) => void
  onDismissMessage: (clientId: string) => void
  onEditMessage: (messageId: string, roomId: string, body: string) => void
  onToggleMessageHidden: (messageId: string, roomId: string) => void
  onToggleMute: () => void
  onResolveExternalFocus: () => void
  onOpenSettings: () => void
  onStartVoice: () => void
  onStartScreenShare: () => void
}

export function ConversationView({
  room,
  messages,
  currentUser,
  archiveFingerprint,
  archiveVerified,
  externalFocusMessageId,
  muted,
  draft,
  isSending,
  mediaLive,
  mediaRoomId,
  channelType,
  peerNames,
  pinnedMessages,
  pinnedMessageIds,
  errorNote,
  onDraftChange,
  onSend,
  onTogglePinMessage,
  onRetryMessage,
  onDismissMessage,
  onEditMessage,
  onToggleMessageHidden,
  onToggleMute,
  onResolveExternalFocus,
  onOpenSettings,
  onStartVoice,
  onStartScreenShare,
}: ConversationViewProps) {
  const { copy, language } = useI18n()
  const [searchOpen, setSearchOpen] = useState(false)
  const [pinsOpen, setPinsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const archiveLabel = describeArchiveStateLabel(copy, archiveFingerprint, archiveVerified)
  const inCurrentCall = mediaLive && mediaRoomId === room?.id
  const isVoiceChannel = channelType === 'voice'
  const searchResults = useMemo(() => searchMessages(messages, searchQuery), [messages, searchQuery])
  const activeSearchIndex = searchResults.length === 0 ? -1 : Math.min(searchIndex, searchResults.length - 1)
  const activeSearchResult = activeSearchIndex >= 0 ? searchResults[activeSearchIndex] : null
  const matchedMessageIds = useMemo(() => searchResults.map((result) => result.messageId), [searchResults])

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[var(--chat)]">
      <header className="flex min-h-14 items-center justify-between border-b border-border px-4 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{formatRoomTitle(room, copy.common.unknownRoom)}</p>
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            {copy.room.participants(room?.participants ?? 0)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {searchOpen ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-[var(--panel-strong)] px-2 py-1">
              <div className="relative w-56">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <Input
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value)
                    setSearchIndex(0)
                  }}
                  placeholder={copy.messages.searchPlaceholder}
                  className="h-8 border-transparent bg-transparent pl-8 pr-2 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0"
                />
              </div>
              <span className="min-w-12 text-right text-xs text-[var(--muted-foreground)]">
                {searchResults.length > 0
                  ? copy.messages.searchCount(activeSearchIndex + 1, searchResults.length)
                  : searchQuery.trim()
                    ? copy.messages.searchNoResults
                    : copy.messages.searchIdle}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() =>
                  setSearchIndex((current) =>
                    searchResults.length === 0 ? 0 : (current - 1 + searchResults.length) % searchResults.length
                  )
                }
                disabled={searchResults.length === 0}
                title={copy.messages.searchPrevious}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() =>
                  setSearchIndex((current) => (searchResults.length === 0 ? 0 : (current + 1) % searchResults.length))
                }
                disabled={searchResults.length === 0}
                title={copy.messages.searchNext}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setSearchOpen(false)
                  setSearchQuery('')
                  setSearchIndex(0)
                }}
                title={copy.messages.searchClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
          <Badge variant={archiveVerified ? 'default' : 'outline'}>{archiveLabel}</Badge>
          <Button
            variant={searchOpen ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => {
              setSearchOpen((current) => !current)
              if (searchOpen) {
                setSearchQuery('')
                setSearchIndex(0)
              }
            }}
            title={copy.messages.search}
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            variant={muted ? 'secondary' : 'ghost'}
            size="icon"
            onClick={onToggleMute}
            title={muted ? copy.messages.unmuteRoom : copy.messages.muteRoom}
          >
            <BellOff className="h-4 w-4" />
          </Button>
          <Button
            variant={pinsOpen ? 'secondary' : 'ghost'}
            className="h-9 gap-2 px-3"
            onClick={() => setPinsOpen((current) => !current)}
            title={copy.messages.pinnedMessages}
          >
            <Pin className="h-4 w-4" />
            <span className="rounded-md bg-[var(--panel-strong)] px-1.5 py-0.5 text-[11px] font-semibold">
              {pinnedMessages.length}
            </span>
          </Button>
          <Button
            variant={inCurrentCall ? 'default' : 'ghost'}
            size="icon"
            onClick={onStartVoice}
            title={
              isVoiceChannel
                ? inCurrentCall
                  ? copy.call.leaveVoiceChannel
                  : copy.call.joinVoiceChannel
                : inCurrentCall
                  ? copy.call.leaveVoiceRoom
                  : copy.call.joinVoiceRoom
            }
          >
            <Phone className="h-4 w-4" />
          </Button>
          <Button
            variant={inCurrentCall ? 'secondary' : 'ghost'}
            size="icon"
            onClick={onStartScreenShare}
            title={copy.call.shareScreen}
            disabled={!inCurrentCall}
          >
            <MonitorUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onOpenSettings} title={copy.common.settings}>
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </header>
      {pinsOpen ? (
        <div className="border-b border-border bg-[var(--panel)]/80 px-4 py-3">
          {pinnedMessages.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {pinnedMessages.map((message) => (
                <button
                  key={message.id}
                  type="button"
                  className="min-w-0 shrink-0 rounded-xl border border-border bg-[var(--panel-strong)] px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                  onClick={() => focusMessageElement(message.id, true)}
                >
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                    <Pin className="h-3.5 w-3.5" />
                    <span>{message.author}</span>
                  </div>
                  <p className="mt-1 max-w-64 truncate text-sm text-foreground/85">
                    {extractPlainText(message.body) || copy.messages.pinnedEmpty}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">{copy.messages.pinnedEmpty}</p>
          )}
        </div>
      ) : null}

      <MessagePanel
        key={`${room?.id ?? 'room'}:${language}`}
        room={room}
        messages={messages}
        currentUser={currentUser}
        matchedMessageIds={matchedMessageIds}
        activeSearchMessageId={activeSearchResult?.messageId}
        activeSearchPreview={activeSearchResult?.preview}
        externalFocusMessageId={externalFocusMessageId}
        draft={draft}
        peerNames={peerNames}
        pinnedMessageIds={pinnedMessageIds}
        onDraftChange={onDraftChange}
        onSend={onSend}
        onTogglePinMessage={onTogglePinMessage}
        onRetryMessage={onRetryMessage}
        onDismissMessage={onDismissMessage}
        onEditMessage={onEditMessage}
        onToggleMessageHidden={onToggleMessageHidden}
        onResolveExternalFocus={onResolveExternalFocus}
        isSending={isSending}
        errorNote={errorNote}
      />
    </section>
  )
}

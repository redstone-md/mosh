import { MonitorUp, Phone, Settings2 } from 'lucide-react'

import { formatRoomTitle } from '../../lib/chatPresentation'
import { describeArchiveStateLabel } from '../../lib/i18n'
import type { ChannelType } from '../../lib/appShellSchemas'
import type { Message, PeerSummary, RoomSummary } from '../../lib/schemas'
import { useI18n } from '../I18nProvider'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { MessagePanel } from '../MessagePanel'

type ConversationViewProps = {
  room: RoomSummary | undefined
  peers: PeerSummary[]
  messages: Message[]
  archiveFingerprint?: string
  archiveVerified?: boolean
  draft: string
  isSending: boolean
  mediaLive: boolean
  mediaRoomId: string | null
  channelType: ChannelType
  peerNames: string[]
  errorNote?: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onOpenSettings: () => void
  onStartVoice: () => void
  onStartScreenShare: () => void
}

export function ConversationView({
  room,
  messages,
  archiveFingerprint,
  archiveVerified,
  draft,
  isSending,
  mediaLive,
  mediaRoomId,
  channelType,
  peerNames,
  errorNote,
  onDraftChange,
  onSend,
  onOpenSettings,
  onStartVoice,
  onStartScreenShare,
}: ConversationViewProps) {
  const { copy, language } = useI18n()
  const archiveLabel = describeArchiveStateLabel(copy, archiveFingerprint, archiveVerified)
  const inCurrentCall = mediaLive && mediaRoomId === room?.id
  const isVoiceChannel = channelType === 'voice'

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[var(--chat)]">
      <header className="flex h-14 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{formatRoomTitle(room, copy.common.unknownRoom)}</p>
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            {copy.room.participants(room?.participants ?? 0)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={archiveVerified ? 'default' : 'outline'}>{archiveLabel}</Badge>
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

      <MessagePanel
        key={`${room?.id ?? 'room'}:${language}`}
        room={room}
        messages={messages}
        draft={draft}
        peerNames={peerNames}
        onDraftChange={onDraftChange}
        onSend={onSend}
        isSending={isSending}
        errorNote={errorNote}
      />
    </section>
  )
}

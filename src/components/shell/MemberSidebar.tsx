import { Fingerprint, MessageSquare, Radio } from 'lucide-react'

import { describeArchiveStateLabel, localizePeerStatus } from '../../lib/i18n'
import { initialsFromName } from '../../lib/chatPresentation'
import type { PeerSummary, RoomSummary, VoiceRoom } from '../../lib/schemas'
import { useI18n } from '../I18nProvider'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'

type MemberSidebarProps = {
  room: RoomSummary | undefined
  peers: PeerSummary[]
  archiveFingerprint?: string
  archiveVerified?: boolean
  mediaLabel: string
  activeVoiceRoom: VoiceRoom | null
  onOpenDirectRoom: (target: string) => void
}

export function MemberSidebar({
  room,
  peers,
  archiveFingerprint,
  archiveVerified,
  mediaLabel,
  activeVoiceRoom,
  onOpenDirectRoom,
}: MemberSidebarProps) {
  const { copy } = useI18n()

  return (
    <aside className="hidden w-[260px] shrink-0 border-l border-border bg-[var(--sidebar)] xl:flex xl:flex-col">
      <div className="border-b border-border px-4 py-4">
        <p className="text-sm font-semibold">
          {copy.room.members(peers.length)} · {room?.label ?? copy.common.unknownRoom}
        </p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{mediaLabel}</p>
      </div>
      <div className="space-y-3 border-b border-border px-4 py-4">
        <div className="rounded-md border border-border bg-[var(--panel-strong)] p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Fingerprint className="h-4 w-4" />
            {copy.archive.title}
          </div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            {archiveFingerprint
              ? describeArchiveStateLabel(copy, archiveFingerprint, archiveVerified)
              : copy.archive.firstPersistedMessage}
          </p>
        </div>
        <div className="rounded-md border border-border bg-[var(--panel-strong)] p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Radio className="h-4 w-4" />
            {copy.call.status}
          </div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">{mediaLabel}</p>
          {activeVoiceRoom ? (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              {copy.call.inVoice(activeVoiceRoom.participants.length)}
            </p>
          ) : null}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-3">
          {peers.map((peer) => (
            <div key={peer.id} className="flex items-center gap-3 rounded-md px-2 py-2">
              <Avatar>
                <AvatarFallback>{initialsFromName(peer.displayName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{peer.displayName}</p>
                <p className="truncate text-xs text-[var(--muted-foreground)]">{peer.route}</p>
              </div>
              {peer.status !== 'self' ? (
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onOpenDirectRoom(peer.displayName)}
                    title={`${copy.sidebar.directMessages}: ${peer.displayName}`}
                  >
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                  {activeVoiceRoom?.participants.some((participant) => participant.peerId === peer.id) ? (
                    <Badge variant="default">{copy.common.voice.toLowerCase()}</Badge>
                  ) : null}
                </div>
              ) : (
                <Badge variant="default">{localizePeerStatus(copy, peer.status)}</Badge>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}

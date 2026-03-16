import { Fingerprint, MessageSquare, Radio } from 'lucide-react'

import { initialsFromName } from '../../lib/chatPresentation'
import type { PeerSummary, RoomSummary, VoiceRoom } from '../../lib/schemas'
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
  return (
    <aside className="hidden w-[260px] shrink-0 border-l border-border bg-[var(--sidebar)] xl:flex xl:flex-col">
      <div className="border-b border-border px-4 py-4">
        <p className="text-sm font-semibold">Members in {room?.label ?? 'room'}</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{mediaLabel}</p>
      </div>
      <div className="space-y-3 border-b border-border px-4 py-4">
        <div className="rounded-md border border-border bg-[var(--panel-strong)] p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Fingerprint className="h-4 w-4" />
            Signed archive
          </div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            {archiveFingerprint
              ? `${archiveVerified ? 'Verified' : 'Verification failed'} • ${archiveFingerprint}`
              : 'Archive will be signed after the first persisted message set.'}
          </p>
        </div>
        <div className="rounded-md border border-border bg-[var(--panel-strong)] p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Radio className="h-4 w-4" />
            Call status
          </div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">{mediaLabel}</p>
          {activeVoiceRoom ? (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              {activeVoiceRoom.participants.length} in voice
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
                    title={`Message ${peer.displayName}`}
                  >
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                  {activeVoiceRoom?.participants.some((participant) => participant.peerId === peer.id) ? (
                    <Badge variant="default">voice</Badge>
                  ) : null}
                </div>
              ) : (
                <Badge variant="default">{peer.status}</Badge>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}

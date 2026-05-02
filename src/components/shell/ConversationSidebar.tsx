import { BellOff, Hash, LockKeyhole, PenSquare, Plus, Search, Settings, UserRound, Volume2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import type { ChannelType, RoomGroup } from '../../lib/appShellSchemas'
import { localizePeerStatus, localizeRuntimeState } from '../../lib/i18n'
import { formatRoomTitle, initialsFromName } from '../../lib/chatPresentation'
import type { PeerSummary, RoomSummary, RuntimeStatus, VoiceRoom } from '../../lib/schemas'
import { cn } from '../../lib/utils'
import { useI18n } from '../I18nProvider'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ScrollArea } from '../ui/scroll-area'

type ConversationSidebarProps = {
  runtime: RuntimeStatus
  currentUser: string
  selectedDock: 'home' | 'group'
  activeGroup: RoomGroup | undefined
  rooms: RoomSummary[]
  peers: PeerSummary[]
  selectedRoomId: string
  unreadCounts: Record<string, number>
  draftPreviews: Record<string, string>
  mutedRoomIds: string[]
  mediaLabel: string
  roomTypes: Record<string, ChannelType>
  activeVoiceRoom: VoiceRoom | null
  onSelectRoom: (roomId: string) => void
  onOpenSettings: () => void
  onOpenCreate: () => void
  onOpenDirectRoom: (target: string) => void
}

export function ConversationSidebar({
  runtime,
  currentUser,
  selectedDock,
  activeGroup,
  rooms,
  peers,
  selectedRoomId,
  unreadCounts,
  draftPreviews,
  mutedRoomIds,
  mediaLabel,
  roomTypes,
  activeVoiceRoom,
  onSelectRoom,
  onOpenSettings,
  onOpenCreate,
  onOpenDirectRoom,
}: ConversationSidebarProps) {
  const { copy } = useI18n()
  const [search, setSearch] = useState('')

  const filteredRooms = useMemo(() => {
    const baseRooms =
      selectedDock === 'home'
        ? rooms.filter((room) => room.kind === 'dm' || room.kind === 'secret-dm')
        : rooms.filter((room) => activeGroup?.roomIds.includes(room.id))

    if (!search.trim()) {
      return baseRooms
    }

    const needle = search.trim().toLowerCase()
    return baseRooms.filter((room) => room.label.toLowerCase().includes(needle))
  }, [activeGroup?.roomIds, rooms, search, selectedDock])

  const discoverablePeers = peers.filter((peer) => peer.status !== 'self')

  return (
    <aside className="flex w-[290px] shrink-0 flex-col border-r border-border bg-[var(--sidebar)]">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">
              {selectedDock === 'home' ? copy.sidebar.directMessages : (activeGroup?.name ?? copy.common.group)}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">{localizeRuntimeState(copy, runtime.state)}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onOpenCreate} title={copy.sidebar.createSpace}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
            placeholder={selectedDock === 'home' ? copy.sidebar.searchConversations : copy.sidebar.searchChannels}
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-5 p-3">
          {selectedDock === 'home' ? (
            <>
              <SidebarSection title={copy.sidebar.pinnedDms}>
                {filteredRooms.length > 0 ? (
                  filteredRooms.map((room) => (
                    <RoomButton
                      key={room.id}
                      room={room}
                      channelType="text"
                      selected={room.id === selectedRoomId}
                      unreadCount={unreadCounts[room.id] ?? room.unread}
                      draftPreview={draftPreviews[room.id]}
                      draftLabel={copy.common.draft}
                      muted={mutedRoomIds.includes(room.id)}
                      activeVoiceRoom={activeVoiceRoom}
                      onClick={() => onSelectRoom(room.id)}
                    />
                  ))
                ) : (
                  <EmptyNote label={copy.sidebar.noDirectRooms} />
                )}
              </SidebarSection>

              <SidebarSection title={copy.sidebar.peersOnline}>
                {discoverablePeers.length > 0 ? (
                  discoverablePeers.map((peer) => (
                    <button
                      key={peer.id}
                      className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-[var(--panel-strong)]"
                      onClick={() => onOpenDirectRoom(peer.displayName)}
                    >
                      <span className="truncate">{peer.displayName}</span>
                      <Badge variant="outline">{localizePeerStatus(copy, peer.status)}</Badge>
                    </button>
                  ))
                ) : (
                  <EmptyNote label={copy.sidebar.waitForPeers} />
                )}
              </SidebarSection>
            </>
          ) : (
            <>
              <SidebarSection title={copy.common.channels}>
                {filteredRooms.filter((room) => roomTypes[room.id] !== 'voice').length > 0 ? (
                  filteredRooms
                    .filter((room) => roomTypes[room.id] !== 'voice')
                    .map((room) => (
                      <RoomButton
                        key={room.id}
                        room={room}
                        channelType={roomTypes[room.id] ?? 'text'}
                        selected={room.id === selectedRoomId}
                        unreadCount={unreadCounts[room.id] ?? room.unread}
                        draftPreview={draftPreviews[room.id]}
                        draftLabel={copy.common.draft}
                        muted={mutedRoomIds.includes(room.id)}
                        activeVoiceRoom={activeVoiceRoom}
                        onClick={() => onSelectRoom(room.id)}
                      />
                    ))
                ) : (
                  <EmptyNote label={copy.sidebar.noTextChannels} />
                )}
              </SidebarSection>
              <SidebarSection title={copy.common.voice}>
                {filteredRooms.filter((room) => roomTypes[room.id] === 'voice').length > 0 ? (
                  filteredRooms
                    .filter((room) => roomTypes[room.id] === 'voice')
                    .map((room) => (
                      <RoomButton
                        key={room.id}
                        room={room}
                        channelType="voice"
                        selected={room.id === selectedRoomId}
                        unreadCount={unreadCounts[room.id] ?? room.unread}
                        draftPreview={draftPreviews[room.id]}
                        draftLabel={copy.common.draft}
                        muted={mutedRoomIds.includes(room.id)}
                        activeVoiceRoom={activeVoiceRoom}
                        onClick={() => onSelectRoom(room.id)}
                      />
                    ))
                ) : (
                  <EmptyNote label={copy.sidebar.noVoiceChannels} />
                )}
              </SidebarSection>
              <SidebarSection title={copy.sidebar.utilities}>
                {rooms
                  .filter((room) => room.kind === 'system')
                  .map((room) => (
                    <RoomButton
                      key={room.id}
                      room={room}
                      channelType="text"
                      selected={room.id === selectedRoomId}
                      unreadCount={unreadCounts[room.id] ?? room.unread}
                      draftPreview={draftPreviews[room.id]}
                      draftLabel={copy.common.draft}
                      muted={mutedRoomIds.includes(room.id)}
                      activeVoiceRoom={activeVoiceRoom}
                      onClick={() => onSelectRoom(room.id)}
                    />
                  ))}
              </SidebarSection>
            </>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-[var(--rail)] p-3">
        <div className="flex items-center gap-3 rounded-md bg-[var(--panel-strong)] px-3 py-2">
          <Avatar>
            <AvatarFallback>{initialsFromName(currentUser)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{currentUser}</p>
            <p className="truncate text-xs text-[var(--muted-foreground)]">{mediaLabel}</p>
          </div>
          <Button size="icon" variant="ghost" onClick={onOpenSettings} title={copy.common.preferences}>
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  )
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-2">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{title}</p>
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function RoomButton({
  room,
  channelType,
  selected,
  unreadCount,
  draftPreview,
  draftLabel,
  muted,
  activeVoiceRoom,
  onClick,
}: {
  room: RoomSummary
  channelType: ChannelType
  selected: boolean
  unreadCount: number
  draftPreview?: string
  draftLabel: string
  muted: boolean
  activeVoiceRoom: VoiceRoom | null
  onClick: () => void
}) {
  const voiceCount =
    channelType === 'voice' && activeVoiceRoom?.roomId === room.id ? activeVoiceRoom.participants.length : 0
  return (
    <button
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors',
        selected
          ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
          : 'text-foreground hover:bg-[var(--panel-strong)]'
      )}
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-2">
        {room.kind === 'secret-dm' ? (
          <LockKeyhole className="h-4 w-4 shrink-0" />
        ) : room.kind === 'dm' ? (
          <UserRound className="h-4 w-4 shrink-0" />
        ) : channelType === 'voice' ? (
          <Volume2 className="h-4 w-4 shrink-0" />
        ) : (
          <Hash className="h-4 w-4 shrink-0" />
        )}
        <span className="min-w-0">
          <span className="block truncate">{formatRoomTitle(room)}</span>
          {draftPreview ? (
            <span
              className={cn(
                'mt-0.5 flex items-center gap-1 truncate text-[11px]',
                selected ? 'text-[var(--primary-foreground)]/75' : 'text-[var(--muted-foreground)]'
              )}
            >
              <PenSquare className="h-3 w-3 shrink-0" />
              {draftPreview}
            </span>
          ) : null}
        </span>
        {muted ? <BellOff className="h-3.5 w-3.5 shrink-0 opacity-70" /> : null}
      </span>
      {voiceCount > 0 ? (
        <Badge variant="default">{voiceCount}</Badge>
      ) : unreadCount > 0 ? (
        <Badge variant="secondary">{unreadCount}</Badge>
      ) : draftPreview ? (
        <Badge variant="outline">{draftLabel}</Badge>
      ) : null}
    </button>
  )
}

function EmptyNote({ label }: { label: string }) {
  return <p className="px-2 py-2 text-sm text-[var(--muted-foreground)]">{label}</p>
}

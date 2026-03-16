import { z } from 'zod'
import { PencilLine, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { channelTypeSchema, groupAccentSchema, roomGroupSchema, type ChannelType, type RoomGroup } from '../../lib/appShellSchemas'
import { getGroupAccentClass } from '../../lib/chatPresentation'
import type { RoomSummary } from '../../lib/schemas'
import { cn } from '../../lib/utils'
import { useI18n } from '../I18nProvider'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

const workspaceDraftSchema = z.object({
  groups: z.array(roomGroupSchema).max(32),
  roomTypes: z.record(z.string(), channelTypeSchema),
  selectedGroupId: z.string().min(1),
})

type WorkspaceEditorProps = {
  groups: RoomGroup[]
  rooms: RoomSummary[]
  roomTypes: Record<string, ChannelType>
  selectedGroupId: string
  onSave: (
    groups: RoomGroup[],
    roomTypes: Record<string, ChannelType>,
    selectedGroupId: string,
  ) => void
}

function createDraftGroup(index: number, label: string): RoomGroup {
  return {
    id: `group-${Date.now().toString(36)}-${index.toString(36)}`,
    name: label,
    icon: `G${(index + 1).toString(36).toUpperCase()}`,
    accent: 'slate',
    roomIds: [],
  }
}

function buildInitialAssignments(groups: RoomGroup[], rooms: RoomSummary[]) {
  const firstGroupId = groups[0]?.id ?? ''
  const assignments: Record<string, string> = {}

  for (const room of rooms) {
    assignments[room.id] = groups.find((group) => group.roomIds.includes(room.id))?.id ?? firstGroupId
  }

  return assignments
}

function buildGroups(
  groups: RoomGroup[],
  rooms: RoomSummary[],
  assignments: Record<string, string>,
): RoomGroup[] {
  return groups.map((group) => ({
    ...group,
    roomIds: rooms.filter((room) => assignments[room.id] === group.id).map((room) => room.id),
  }))
}

export function WorkspaceEditor({
  groups,
  rooms,
  roomTypes,
  selectedGroupId,
  onSave,
}: WorkspaceEditorProps) {
  const { copy } = useI18n()
  const channelRooms = useMemo(
    () => rooms.filter((room) => room.kind === 'channel'),
    [rooms],
  )
  const [draftGroups, setDraftGroups] = useState(() => groups)
  const [draftRoomTypes, setDraftRoomTypes] = useState(() => roomTypes)
  const [roomAssignments, setRoomAssignments] = useState(() => buildInitialAssignments(groups, channelRooms))
  const [draftSelectedGroupId, setDraftSelectedGroupId] = useState(
    () => groups.find((group) => group.id === selectedGroupId)?.id ?? groups[0]?.id ?? '',
  )
  const [errorNote, setErrorNote] = useState<string | null>(null)

  const selectedGroup = draftGroups.find((group) => group.id === draftSelectedGroupId) ?? draftGroups[0]
  const selectedGroupChannelIds = new Set(
    channelRooms
      .filter((room) => roomAssignments[room.id] === selectedGroup?.id)
      .map((room) => room.id),
  )

  function handleCreateGroup() {
    setDraftGroups((current) => {
      const nextGroup = createDraftGroup(current.length, copy.workspace.groupName(current.length + 1))
      setDraftSelectedGroupId(nextGroup.id)
      return [...current, nextGroup]
    })
  }

  function handleDeleteGroup(groupId: string) {
    setDraftGroups((current) => {
      const remaining = current.filter((group) => group.id !== groupId)
      const fallbackGroup = remaining[0] ?? createDraftGroup(0, copy.workspace.groupName(1))
      const nextGroups = remaining.length > 0 ? remaining : [fallbackGroup]

      setRoomAssignments((assignments) => {
        const nextAssignments = { ...assignments }
        for (const room of channelRooms) {
          if (nextAssignments[room.id] === groupId) {
            nextAssignments[room.id] = fallbackGroup.id
          }
        }
        return nextAssignments
      })
      setDraftSelectedGroupId((currentGroupId) =>
        currentGroupId === groupId ? fallbackGroup.id : currentGroupId,
      )

      return nextGroups
    })
  }

  function handleSaveWorkspace() {
    if (draftGroups.length === 0) {
      setErrorNote(copy.workspace.createGroupFirst)
      return
    }

    const nextGroups = buildGroups(draftGroups, channelRooms, roomAssignments)
    const parsed = workspaceDraftSchema.safeParse({
      groups: nextGroups,
      roomTypes: channelRooms.reduce<Record<string, ChannelType>>((result, room) => {
        result[room.id] = draftRoomTypes[room.id] ?? 'text'
        return result
      }, {}),
      selectedGroupId:
        nextGroups.find((group) => group.id === draftSelectedGroupId)?.id ?? nextGroups[0]?.id ?? '',
    })

    if (!parsed.success) {
      setErrorNote(copy.workspace.invalidLayout)
      return
    }

    setErrorNote(null)
    onSave(parsed.data.groups, parsed.data.roomTypes, parsed.data.selectedGroupId)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <section className="rounded-md border border-border bg-[var(--panel-strong)]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-medium">{copy.common.groups}</p>
          <Button variant="outline" size="sm" onClick={handleCreateGroup}>
            {copy.workspace.addGroup}
          </Button>
        </div>
        <div className="space-y-1 p-2">
          {draftGroups.map((group) => {
            const isActive = group.id === selectedGroup?.id
            const channelCount = channelRooms.filter((room) => roomAssignments[room.id] === group.id).length
            return (
              <button
                key={group.id}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                  isActive ? 'bg-[var(--panel)] text-foreground' : 'text-[var(--muted-foreground)] hover:bg-[var(--panel)]',
                )}
                onClick={() => setDraftSelectedGroupId(group.id)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold', getGroupAccentClass(group))}>
                    {group.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{group.name}</span>
                    <span className="block text-xs text-[var(--muted-foreground)]">{copy.workspace.channelCount(channelCount)}</span>
                  </span>
                </span>
                {isActive ? <Badge variant="secondary">{copy.common.active}</Badge> : null}
              </button>
            )
          })}
        </div>
      </section>

      <div className="space-y-4">
        <section className="rounded-md border border-border bg-[var(--panel-strong)]">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-medium">{copy.workspace.groupSettings}</p>
          </div>
          {selectedGroup ? (
            <div className="space-y-4 p-4">
              <div className="grid gap-4 md:grid-cols-[1fr_110px]">
                <div className="space-y-2">
                  <Label htmlFor="workspace-group-name">{copy.workspace.name}</Label>
                  <Input
                    id="workspace-group-name"
                    value={selectedGroup.name}
                    onChange={(event) =>
                      setDraftGroups((current) =>
                        current.map((group) =>
                          group.id === selectedGroup.id
                            ? { ...group, name: event.target.value }
                            : group,
                        ),
                      )
                    }
                    placeholder="Ops"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspace-group-icon">{copy.workspace.icon}</Label>
                  <Input
                    id="workspace-group-icon"
                    value={selectedGroup.icon}
                    onChange={(event) =>
                      setDraftGroups((current) =>
                        current.map((group) =>
                          group.id === selectedGroup.id
                            ? { ...group, icon: event.target.value.toUpperCase() }
                            : group,
                        ),
                      )
                    }
                    placeholder="OP"
                    maxLength={2}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{copy.workspace.accent}</Label>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {groupAccentSchema.options.map((accent) => (
                    <button
                      key={accent}
                      className={cn(
                        'rounded-md border px-3 py-2 text-left text-sm capitalize transition-colors',
                        selectedGroup.accent === accent
                          ? 'border-[var(--primary)] bg-[var(--panel)]'
                          : 'border-border bg-[var(--panel-strong)] hover:bg-[var(--panel)]',
                      )}
                      onClick={() =>
                        setDraftGroups((current) =>
                          current.map((group) =>
                            group.id === selectedGroup.id ? { ...group, accent } : group,
                          ),
                        )
                      }
                    >
                      {copy.workspace.accents[accent]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border bg-[var(--panel)] px-3 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <PencilLine className="h-4 w-4 text-[var(--muted-foreground)]" />
                  <span>{copy.workspace.channelsRouted(selectedGroupChannelIds.size)}</span>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDeleteGroup(selectedGroup.id)}
                >
                  <Trash2 className="h-4 w-4" />
                  {copy.workspace.deleteGroup}
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-4 text-sm text-[var(--muted-foreground)]">{copy.workspace.createGroupToStart}</div>
          )}
        </section>

        <section className="rounded-md border border-border bg-[var(--panel-strong)]">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-medium">{copy.workspace.channelRouting}</p>
            <p className="text-xs text-[var(--muted-foreground)]">{copy.workspace.routingNote}</p>
          </div>
          <div className="space-y-3 p-4">
            {channelRooms.length > 0 ? (
              channelRooms.map((room) => (
                <div
                  key={room.id}
                  className="grid gap-3 rounded-md border border-border bg-[var(--panel)] px-3 py-3 md:grid-cols-[minmax(0,1fr)_170px_150px]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">#{room.label}</p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">{room.id}</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-[var(--muted-foreground)]">{copy.workspace.groupSelect}</Label>
                    <Select
                      value={roomAssignments[room.id] ?? draftGroups[0]?.id}
                      onValueChange={(value) =>
                        setRoomAssignments((current) => ({
                          ...current,
                          [room.id]: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {draftGroups.map((group) => (
                          <SelectItem key={group.id} value={group.id}>
                            {group.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-[var(--muted-foreground)]">{copy.workspace.typeSelect}</Label>
                    <Select
                      value={draftRoomTypes[room.id] ?? 'text'}
                      onValueChange={(value: ChannelType) =>
                        setDraftRoomTypes((current) => ({
                          ...current,
                          [room.id]: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">{copy.common.text}</SelectItem>
                        <SelectItem value="voice">{copy.common.voice}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">{copy.workspace.joinChannelFirst}</p>
            )}
          </div>
        </section>

        <div className="flex items-center justify-between gap-3">
          {errorNote ? <p className="text-sm text-[var(--danger)]">{errorNote}</p> : <span />}
          <Button onClick={handleSaveWorkspace}>{copy.workspace.saveWorkspace}</Button>
        </div>
      </div>
    </div>
  )
}

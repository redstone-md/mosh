import { z } from 'zod'
import { useMemo, useState } from 'react'

import { channelTypeSchema, groupAccentSchema, roomGroupSchema } from '../../lib/appShellSchemas'
import type { PeerSummary, RoomSummary } from '../../lib/schemas'
import { useI18n } from '../I18nProvider'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'

const createChannelSchema = z.object({
  room: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dot, dash, or underscore'),
})

const createDirectSchema = z.object({
  target: z.string().trim().min(1).max(128),
})

const createGroupSchema = roomGroupSchema.pick({
  name: true,
  icon: true,
  accent: true,
  roomIds: true,
})

type CreateSpaceDialogProps = {
  open: boolean
  availableChannels: RoomSummary[]
  peers: PeerSummary[]
  onOpenChange: (open: boolean) => void
  onCreateChannel: (room: string, channelType: z.infer<typeof channelTypeSchema>) => void
  onCreateGroup: (group: z.infer<typeof createGroupSchema>) => void
  onCreateDirect: (target: string) => void
}

export function CreateSpaceDialog({
  open,
  availableChannels,
  peers,
  onOpenChange,
  onCreateChannel,
  onCreateGroup,
  onCreateDirect,
}: CreateSpaceDialogProps) {
  const { copy } = useI18n()
  const [channelName, setChannelName] = useState('')
  const [channelType, setChannelType] = useState<z.infer<typeof channelTypeSchema>>('text')
  const [directTarget, setDirectTarget] = useState('')
  const [groupName, setGroupName] = useState('')
  const [groupIcon, setGroupIcon] = useState('GR')
  const [groupAccent, setGroupAccent] = useState<z.infer<typeof groupAccentSchema>>('forest')
  const [groupRoomIds, setGroupRoomIds] = useState<string[]>([])
  const [errorNote, setErrorNote] = useState<string | null>(null)

  const peerPlaceholders = useMemo(
    () =>
      peers
        .filter((peer) => peer.status !== 'self')
        .slice(0, 4)
        .map((peer) => peer.displayName)
        .join(', '),
    [peers],
  )

  function handleCreateChannel() {
    const result = createChannelSchema.safeParse({
      room: channelName,
    })
    if (!result.success) {
      setErrorNote(copy.createSpace.channelNameInvalid)
      return
    }
    setErrorNote(null)
    onCreateChannel(result.data.room, channelType)
    setChannelName('')
    setChannelType('text')
    onOpenChange(false)
  }

  function handleCreateDirect() {
    const result = createDirectSchema.safeParse({
      target: directTarget,
    })
    if (!result.success) {
      setErrorNote(copy.createSpace.peerTargetInvalid)
      return
    }
    setErrorNote(null)
    onCreateDirect(result.data.target)
    setDirectTarget('')
    onOpenChange(false)
  }

  function handleCreateGroup() {
    const result = createGroupSchema.safeParse({
      name: groupName,
      icon: groupIcon,
      accent: groupAccent,
      roomIds: groupRoomIds,
    })
    if (!result.success) {
      setErrorNote(copy.createSpace.groupInvalid)
      return
    }
    setErrorNote(null)
    onCreateGroup(result.data)
    setGroupName('')
    setGroupIcon('GR')
    setGroupRoomIds([])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.createSpace.title}</DialogTitle>
          <DialogDescription>{copy.createSpace.description}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="channel" className="space-y-4">
          <TabsList>
            <TabsTrigger value="channel">{copy.common.channel}</TabsTrigger>
            <TabsTrigger value="direct">{copy.common.direct}</TabsTrigger>
            <TabsTrigger value="group">{copy.common.group}</TabsTrigger>
          </TabsList>

          <TabsContent value="channel" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="channel-name">{copy.createSpace.channelName}</Label>
              <Input
                id="channel-name"
                value={channelName}
                onChange={(event) => setChannelName(event.target.value)}
                placeholder="release-room"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="channel-type">{copy.createSpace.channelType}</Label>
              <Select
                value={channelType}
                onValueChange={(value: z.infer<typeof channelTypeSchema>) => setChannelType(value)}
              >
                <SelectTrigger id="channel-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">{copy.createSpace.textChannel}</SelectItem>
                  <SelectItem value="voice">{copy.createSpace.voiceChannel}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button onClick={handleCreateChannel}>{copy.createSpace.joinCreateChannel}</Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="direct" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="direct-target">{copy.createSpace.peerNickname}</Label>
              <Input
                id="direct-target"
                value={directTarget}
                onChange={(event) => setDirectTarget(event.target.value)}
                placeholder={peerPlaceholders || 'teammate'}
              />
            </div>
            <DialogFooter>
              <Button onClick={handleCreateDirect}>{copy.createSpace.openDirectRoom}</Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="group" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="group-name">{copy.createSpace.groupName}</Label>
                <Input
                  id="group-name"
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="Ops"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-icon">{copy.workspace.icon}</Label>
                <Input
                  id="group-icon"
                  value={groupIcon}
                  onChange={(event) => setGroupIcon(event.target.value)}
                  placeholder="OP"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{copy.workspace.accent}</Label>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {groupAccentSchema.options.map((accent) => (
                  <button
                    key={accent}
                    className={`rounded-md border px-3 py-2 text-sm capitalize ${
                      groupAccent === accent
                        ? 'border-[var(--primary)] bg-[var(--panel)]'
                        : 'border-border bg-[var(--panel-strong)]'
                    }`}
                    onClick={() => setGroupAccent(accent)}
                  >
                    {copy.workspace.accents[accent]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{copy.workspace.assignedChannels}</Label>
              <div className="grid max-h-44 gap-2 overflow-y-auto rounded-md border border-border bg-[var(--panel-strong)] p-3">
                {availableChannels.length > 0 ? (
                  availableChannels.map((room) => {
                    const checked = groupRoomIds.includes(room.id)
                    return (
                      <label key={room.id} className="flex items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--primary)]"
                          checked={checked}
                          onChange={(event) =>
                            setGroupRoomIds((current) =>
                              event.target.checked
                                ? [...current, room.id]
                                : current.filter((roomId) => roomId !== room.id),
                            )
                          }
                        />
                        {room.label}
                      </label>
                    )
                  })
                ) : (
                  <p className="text-sm text-[var(--muted-foreground)]">{copy.createSpace.joinChannelFirst}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCreateGroup}>{copy.createSpace.createGroup}</Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>

        {errorNote ? <p className="text-sm text-[var(--danger)]">{errorNote}</p> : null}
      </DialogContent>
    </Dialog>
  )
}

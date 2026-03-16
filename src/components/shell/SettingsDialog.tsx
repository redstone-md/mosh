import type { ChannelType, RoomGroup, ThemeId } from '../../lib/appShellSchemas'
import { getThemeLabel } from '../../lib/appShellStorage'
import type { RoomSummary, UpdateRuntimeSettingsInput } from '../../lib/schemas'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { RuntimeSettingsForm } from './RuntimeSettingsForm'
import { WorkspaceEditor } from './WorkspaceEditor'

type SettingsDialogProps = {
  open: boolean
  theme: ThemeId
  runtimeDraft: UpdateRuntimeSettingsInput
  groups: RoomGroup[]
  rooms: RoomSummary[]
  roomTypes: Record<string, ChannelType>
  selectedGroupId: string
  runtimeError?: string
  archiveLabel: string
  archiveFingerprint?: string
  archiveVerified?: boolean
  saving: boolean
  onOpenChange: (open: boolean) => void
  onThemeChange: (theme: ThemeId) => void
  onRuntimeDraftChange: (draft: UpdateRuntimeSettingsInput) => void
  onSaveRuntime: () => void
  onSaveWorkspace: (
    groups: RoomGroup[],
    roomTypes: Record<string, ChannelType>,
    selectedGroupId: string,
  ) => void
  onResetOnboarding: () => void
}

export function SettingsDialog({
  open,
  theme,
  runtimeDraft,
  groups,
  rooms,
  roomTypes,
  selectedGroupId,
  runtimeError,
  archiveLabel,
  archiveFingerprint,
  archiveVerified,
  saving,
  onOpenChange,
  onThemeChange,
  onRuntimeDraftChange,
  onSaveRuntime,
  onSaveWorkspace,
  onResetOnboarding,
}: SettingsDialogProps) {
  const workspaceEditorKey = JSON.stringify({
    groups,
    roomTypes,
    selectedGroupId,
    roomIds: rooms.filter((room) => room.kind === 'channel').map((room) => room.id),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Preferences</DialogTitle>
          <DialogDescription>Appearance, runtime boot settings, and signed local archive metadata.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="appearance" className="space-y-5">
          <TabsList>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
            <TabsTrigger value="runtime">Runtime</TabsTrigger>
            <TabsTrigger value="archive">Archive</TabsTrigger>
          </TabsList>

          <TabsContent value="appearance" className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Theme</p>
              <div className="max-w-xs">
                <Select value={theme} onValueChange={(value: ThemeId) => onThemeChange(value)}>
                  <SelectTrigger>
                    <SelectValue>{getThemeLabel(theme)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="moss">Moss</SelectItem>
                    <SelectItem value="graphite">Graphite</SelectItem>
                    <SelectItem value="linen">Linen</SelectItem>
                    <SelectItem value="ember">Ember</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4 text-sm text-[var(--muted-foreground)]">
              Current archive status: {archiveLabel}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={onResetOnboarding}>
                Show onboarding on next launch
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="workspace">
            <WorkspaceEditor
              key={workspaceEditorKey}
              groups={groups}
              rooms={rooms}
              roomTypes={roomTypes}
              selectedGroupId={selectedGroupId}
              onSave={onSaveWorkspace}
            />
          </TabsContent>

          <TabsContent value="runtime">
            <RuntimeSettingsForm
              draft={runtimeDraft}
              disabled={saving}
              submitLabel={saving ? 'Saving...' : 'Save runtime settings'}
              errorNote={runtimeError}
              onDraftChange={onRuntimeDraftChange}
              onSubmit={onSaveRuntime}
            />
          </TabsContent>

          <TabsContent value="archive" className="space-y-4">
            <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
              <p className="text-sm font-medium">Signed transcript</p>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{archiveLabel}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
                <p className="text-sm font-medium">Fingerprint</p>
                <p className="mt-2 font-mono text-sm text-[var(--muted-foreground)]">
                  {archiveFingerprint ?? 'No archive written yet'}
                </p>
              </div>
              <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
                <p className="text-sm font-medium">Verification</p>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                  {archiveFingerprint
                    ? archiveVerified
                      ? 'Archive payload matches the stored signature.'
                      : 'Archive payload does not match the stored signature.'
                    : 'Verification starts after the first persisted room snapshot.'}
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

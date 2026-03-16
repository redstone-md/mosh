import type { ChannelType, LanguagePreference, RoomGroup, ThemeId } from '../../lib/appShellSchemas'
import { languagePreferenceOptions } from '../../lib/i18n'
import type { RoomSummary, UpdateRuntimeSettingsInput } from '../../lib/schemas'
import { useI18n } from '../I18nProvider'
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
import { StoragePanel } from './StoragePanel'
import { WorkspaceEditor } from './WorkspaceEditor'

type SettingsDialogProps = {
  open: boolean
  theme: ThemeId
  languagePreference: LanguagePreference
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
  onLanguagePreferenceChange: (languagePreference: LanguagePreference) => void
  onRuntimeDraftChange: (draft: UpdateRuntimeSettingsInput) => void
  onSaveRuntime: () => void
  onSaveWorkspace: (
    groups: RoomGroup[],
    roomTypes: Record<string, ChannelType>,
    selectedGroupId: string,
  ) => void
  onRestoreStorage: () => void
  onResetOnboarding: () => void
}

export function SettingsDialog({
  open,
  theme,
  languagePreference,
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
  onLanguagePreferenceChange,
  onRuntimeDraftChange,
  onSaveRuntime,
  onSaveWorkspace,
  onRestoreStorage,
  onResetOnboarding,
}: SettingsDialogProps) {
  const { copy, getLanguageLabel } = useI18n()
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
          <DialogTitle>{copy.common.preferences}</DialogTitle>
          <DialogDescription>{copy.settings.description}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="appearance" className="space-y-5">
          <TabsList>
            <TabsTrigger value="appearance">{copy.common.appearance}</TabsTrigger>
            <TabsTrigger value="workspace">{copy.common.workspace}</TabsTrigger>
            <TabsTrigger value="runtime">{copy.common.runtime}</TabsTrigger>
            <TabsTrigger value="archive">{copy.common.archive}</TabsTrigger>
            <TabsTrigger value="storage">{copy.common.storage}</TabsTrigger>
          </TabsList>

          <TabsContent value="appearance" className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">{copy.common.theme}</p>
              <div className="max-w-xs">
                <Select value={theme} onValueChange={(value: ThemeId) => onThemeChange(value)}>
                  <SelectTrigger>
                    <SelectValue>{copy.themes[theme]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="moss">{copy.themes.moss}</SelectItem>
                    <SelectItem value="graphite">{copy.themes.graphite}</SelectItem>
                    <SelectItem value="linen">{copy.themes.linen}</SelectItem>
                    <SelectItem value="ember">{copy.themes.ember}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">{copy.common.language}</p>
              <div className="max-w-xs">
                <Select
                  value={languagePreference}
                  onValueChange={(value: LanguagePreference) => onLanguagePreferenceChange(value)}
                >
                  <SelectTrigger>
                    <SelectValue>{getLanguageLabel(languagePreference)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {languagePreferenceOptions.map((value) => (
                      <SelectItem key={value} value={value}>
                        {getLanguageLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4 text-sm text-[var(--muted-foreground)]">
              {copy.archive.currentStatus(archiveLabel)}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={onResetOnboarding}>
                {copy.settings.showOnboarding}
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
              submitLabel={saving ? copy.runtime.saving : copy.runtime.saveSettings}
              errorNote={runtimeError}
              onDraftChange={onRuntimeDraftChange}
              onSubmit={onSaveRuntime}
            />
          </TabsContent>

          <TabsContent value="archive" className="space-y-4">
            <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
              <p className="text-sm font-medium">{copy.archive.transcript}</p>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{archiveLabel}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
                <p className="text-sm font-medium">{copy.archive.fingerprint}</p>
                <p className="mt-2 font-mono text-sm text-[var(--muted-foreground)]">
                  {archiveFingerprint ?? copy.archive.noArchive}
                </p>
              </div>
              <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
                <p className="text-sm font-medium">{copy.archive.verification}</p>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                  {archiveFingerprint
                    ? archiveVerified
                      ? copy.archive.verificationMatches
                      : copy.archive.verificationMismatch
                    : copy.archive.verificationPending}
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="storage">
            <StoragePanel onRestore={onRestoreStorage} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

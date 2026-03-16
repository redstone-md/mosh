import type { UpdateRuntimeSettingsInput } from '../../lib/schemas'
import { useI18n } from '../I18nProvider'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

type RuntimeSettingsFormProps = {
  draft: UpdateRuntimeSettingsInput
  disabled?: boolean
  submitLabel: string
  errorNote?: string
  onDraftChange: (draft: UpdateRuntimeSettingsInput) => void
  onSubmit: () => void
}

export function RuntimeSettingsForm({
  draft,
  disabled,
  submitLabel,
  errorNote,
  onDraftChange,
  onSubmit,
}: RuntimeSettingsFormProps) {
  const { copy } = useI18n()

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="nickname">{copy.form.nickname}</Label>
          <Input
            id="nickname"
            value={draft.nickname}
            disabled={disabled}
            onChange={(event) => onDraftChange({ ...draft, nickname: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mesh-id">{copy.form.meshId}</Label>
          <Input
            id="mesh-id"
            value={draft.meshId}
            disabled={disabled}
            onChange={(event) => onDraftChange({ ...draft, meshId: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="initial-room">{copy.form.initialChannel}</Label>
          <Input
            id="initial-room"
            value={draft.initialRoom}
            disabled={disabled}
            onChange={(event) => onDraftChange({ ...draft, initialRoom: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="startup-peer">{copy.form.startupPeer}</Label>
          <Input
            id="startup-peer"
            value={draft.startupPeer}
            placeholder={copy.form.startupPeerPlaceholder}
            disabled={disabled}
            onChange={(event) => onDraftChange({ ...draft, startupPeer: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="listen-port">{copy.form.listenPort}</Label>
          <Input
            id="listen-port"
            type="number"
            min={0}
            max={65535}
            value={draft.listenPort}
            disabled={disabled}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                listenPort: Number(event.target.value || 0),
              })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tracker-mode">{copy.form.trackerBootstrap}</Label>
          <Select
            value={draft.trackerMode}
            onValueChange={(value: 'default' | 'disabled') =>
              onDraftChange({ ...draft, trackerMode: value })
            }
          >
            <SelectTrigger id="tracker-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{copy.runtime.trackerBuiltIn}</SelectItem>
              <SelectItem value="disabled">{copy.runtime.trackerDisabled}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <label className="flex items-center gap-3 rounded-md border border-border bg-[var(--panel-strong)] px-3 py-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--primary)]"
          checked={draft.lanDiscoveryEnabled}
          disabled={disabled}
          onChange={(event) =>
            onDraftChange({
              ...draft,
              lanDiscoveryEnabled: event.target.checked,
            })
          }
        />
        {copy.form.lanDiscovery}
      </label>

      {errorNote ? <p className="text-sm text-[var(--danger)]">{errorNote}</p> : null}

      <div className="flex justify-end">
        <Button onClick={onSubmit} disabled={disabled}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

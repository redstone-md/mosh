import type { IdentityRollbackSnapshot } from '../../lib/appShellSchemas'
import { useI18n } from '../I18nProvider'
import { Button } from '../ui/button'

type IdentityRollbackPanelProps = {
  snapshots: IdentityRollbackSnapshot[]
  activeFingerprint: string
  restoringSnapshotId?: string
  onRestore: (snapshotId: string) => void
}

export function IdentityRollbackPanel({
  snapshots,
  activeFingerprint,
  restoringSnapshotId,
  onRestore,
}: IdentityRollbackPanelProps) {
  const { copy, language } = useI18n()
  const locale = language === 'ru' ? 'ru-RU' : 'en-US'

  return (
    <section className="rounded-md border border-border bg-[var(--panel-strong)]">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-medium">{copy.identityTransfer.rollbackTitle}</p>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{copy.identityTransfer.rollbackDescription}</p>
      </div>
      {snapshots.length === 0 ? (
        <div className="px-4 py-4 text-sm text-[var(--muted-foreground)]">{copy.identityTransfer.rollbackEmpty}</div>
      ) : (
        <div className="divide-y divide-border">
          {snapshots.map((snapshot) => {
            const isActive = snapshot.fingerprint === activeFingerprint
            const isRestoring = restoringSnapshotId === snapshot.id

            return (
              <div key={snapshot.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_160px]">
                <div className="space-y-1 text-sm text-[var(--muted-foreground)]">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{snapshot.fingerprint}</span>
                    <span className="rounded-md border border-border px-2 py-0.5 text-[11px]">
                      {snapshot.source === 'import'
                        ? copy.identityTransfer.rollbackSourceImport
                        : copy.identityTransfer.rollbackSourceRollback}
                    </span>
                    {isActive ? (
                      <span className="rounded-md border border-border px-2 py-0.5 text-[11px]">
                        {copy.identityTransfer.currentDevice}
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <span className="text-foreground">{copy.identityTransfer.capturedAt}:</span>{' '}
                    <span>{new Date(snapshot.capturedAt).toLocaleString(locale)}</span>
                  </div>
                </div>
                <div className="flex items-start justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isActive || Boolean(restoringSnapshotId)}
                    onClick={() => onRestore(snapshot.id)}
                  >
                    {isRestoring ? copy.identityTransfer.restorePending : copy.identityTransfer.restoreIdentity}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

import type { IdentityTransferEvent } from '../../lib/appShellSchemas'
import { useI18n } from '../I18nProvider'

type IdentityTransferHistoryPanelProps = {
  history: IdentityTransferEvent[]
}

export function IdentityTransferHistoryPanel({ history }: IdentityTransferHistoryPanelProps) {
  const { copy, language } = useI18n()
  const locale = language === 'ru' ? 'ru-RU' : 'en-US'

  return (
    <section className="rounded-md border border-border bg-[var(--panel-strong)]">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-medium">{copy.identityTransfer.historyTitle}</p>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{copy.identityTransfer.historyDescription}</p>
      </div>
      {history.length === 0 ? (
        <div className="px-4 py-4 text-sm text-[var(--muted-foreground)]">{copy.identityTransfer.historyEmpty}</div>
      ) : (
        <div className="divide-y divide-border">
          {history.map((event) => (
            <div key={event.id} className="grid gap-3 px-4 py-4 md:grid-cols-[140px_minmax(0,1fr)_160px]">
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground">
                  {event.action === 'export'
                    ? copy.identityTransfer.historyExport
                    : event.action === 'rollback'
                      ? copy.identityTransfer.historyRollback
                      : copy.identityTransfer.historyImport}
                </div>
                <div className="text-xs text-[var(--muted-foreground)]">
                  {event.channel === 'deep-link'
                    ? copy.identityTransfer.historySourceDeepLink
                    : copy.identityTransfer.historySourceManual}
                </div>
              </div>
              <div className="space-y-1 text-sm text-[var(--muted-foreground)]">
                <div>
                  <span className="text-foreground">{copy.identityTransfer.sourceFingerprint}:</span>{' '}
                  <span className="font-mono text-xs">{event.packageSourceFingerprint}</span>
                </div>
                <div>
                  <span className="text-foreground">{copy.identityTransfer.activeFingerprint}:</span>{' '}
                  <span className="font-mono text-xs">{event.activeFingerprint}</span>
                </div>
                {event.replacedFingerprint ? (
                  <div>
                    <span className="text-foreground">{copy.identityTransfer.replacedFingerprint}:</span>{' '}
                    <span className="font-mono text-xs">{event.replacedFingerprint}</span>
                  </div>
                ) : null}
                {event.packageExportedAt ? (
                  <div>
                    <span className="text-foreground">{copy.identityTransfer.exportedAt}:</span>{' '}
                    <span>{new Date(event.packageExportedAt).toLocaleString(locale)}</span>
                  </div>
                ) : null}
              </div>
              <div className="text-xs text-[var(--muted-foreground)]">
                {new Date(event.occurredAt).toLocaleString(locale)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

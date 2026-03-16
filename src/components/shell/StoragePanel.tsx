import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { open, save } from '@tauri-apps/plugin-dialog'
import toast from 'react-hot-toast'

import type { IdentityTransferEvent } from '../../lib/appShellSchemas'
import type { IdentityTransferEventInput } from '../../lib/identityTransferHistory'
import { desktopStorageClient } from '../../lib/desktopStorageClient'
import { isTauriEnvironment } from '../../lib/tauriEnv'
import { useI18n } from '../I18nProvider'
import { Button } from '../ui/button'
import { IdentityTransferHistoryPanel } from './IdentityTransferHistoryPanel'
import { IdentityTransferPanel } from './IdentityTransferPanel'

function createBackupFileName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `mosh-backup-${timestamp}.json`
}

type StoragePanelProps = {
  identityTransferHistory: IdentityTransferEvent[]
  onRecordTransferEvent: (event: IdentityTransferEventInput) => void
  onRestore: () => void | Promise<void>
}

export function StoragePanel({ identityTransferHistory, onRecordTransferEvent, onRestore }: StoragePanelProps) {
  const { copy } = useI18n()
  const desktopOnly = isTauriEnvironment()
  const queryClient = useQueryClient()
  const overviewQuery = useQuery({
    queryKey: ['storage-overview'],
    queryFn: () => desktopStorageClient.getStorageOverview(),
    enabled: desktopOnly,
  })
  const exportBackup = useMutation({
    mutationFn: async () => {
      const path = await save({
        defaultPath: createBackupFileName(),
        filters: [
          {
            name: 'JSON',
            extensions: ['json'],
          },
        ],
      })

      if (!path) {
        return false
      }

      await desktopStorageClient.exportBackup(path)
      return true
    },
    onSuccess: (written) => {
      if (written) {
        void queryClient.invalidateQueries({ queryKey: ['storage-overview'] })
        toast.success(copy.storage.backupSaved)
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : copy.storage.unavailable)
    },
  })
  const importBackup = useMutation({
    mutationFn: async () => {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'JSON',
            extensions: ['json'],
          },
        ],
      })

      if (!path || Array.isArray(path)) {
        return false
      }

      await desktopStorageClient.importBackup(path)
      return true
    },
    onSuccess: async (restored) => {
      if (!restored) {
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['storage-overview'] })
      await onRestore()
      toast.success(copy.storage.backupImported)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : copy.storage.unavailable)
    },
  })

  if (!desktopOnly) {
    return (
      <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4 text-sm text-[var(--muted-foreground)]">
        {copy.storage.desktopOnly}
      </div>
    )
  }

  if (overviewQuery.isPending) {
    return (
      <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4 text-sm text-[var(--muted-foreground)]">
        {copy.storage.loading}
      </div>
    )
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4 text-sm text-[var(--muted-foreground)]">
        {copy.storage.unavailable}
      </div>
    )
  }

  const overview = overviewQuery.data
  const files = [
    {
      label: copy.storage.settingsFile,
      path: overview.settingsPath,
      present: overview.hasSettings,
    },
    {
      label: copy.storage.identityFile,
      path: overview.identityPath,
      present: overview.hasSigningIdentity,
    },
    {
      label: copy.storage.archivesDirectory,
      path: overview.archivesDir,
      present: overview.archiveCount > 0,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
        <p className="text-sm font-medium">{copy.storage.baseDirectory}</p>
        <p className="mt-2 break-all font-mono text-xs text-[var(--muted-foreground)]">{overview.baseDir}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="rounded-md border border-border bg-[var(--panel-strong)]">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">{copy.storage.files}</div>
          <div className="divide-y divide-border">
            {files.map((file) => (
              <div key={file.label} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">{file.label}</p>
                  <p className="break-all font-mono text-xs text-[var(--muted-foreground)]">{file.path}</p>
                </div>
                <span className="rounded-md border border-border px-2 py-1 text-xs text-[var(--muted-foreground)]">
                  {file.present ? copy.storage.present : copy.storage.missing}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
          <p className="text-sm font-medium">{copy.storage.backup}</p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {copy.storage.archiveCount(overview.archiveCount)}
          </p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{copy.storage.backupNote}</p>
          <Button
            className="mt-4 w-full"
            variant="secondary"
            disabled={exportBackup.isPending || importBackup.isPending}
            onClick={() => exportBackup.mutate()}
          >
            {exportBackup.isPending ? copy.storage.exporting : copy.storage.exportBackup}
          </Button>
          <Button
            className="mt-2 w-full"
            variant="outline"
            disabled={exportBackup.isPending || importBackup.isPending}
            onClick={() => importBackup.mutate()}
          >
            {importBackup.isPending ? copy.storage.importing : copy.storage.importBackup}
          </Button>
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">{copy.storage.importNote}</p>
        </div>
      </div>

      <IdentityTransferPanel onImported={onRestore} onRecordEvent={onRecordTransferEvent} />
      <IdentityTransferHistoryPanel history={identityTransferHistory} />
    </div>
  )
}

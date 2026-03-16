import { useDeferredValue, useMemo, useState } from 'react'
import { Archive, Hash, Search } from 'lucide-react'

import type { GlobalSearchEntry, GlobalSearchResult } from '../../lib/globalMessageSearch'
import { searchGlobalMessages } from '../../lib/globalMessageSearch'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { useI18n } from '../I18nProvider'

type GlobalSearchDialogProps = {
  open: boolean
  entries: GlobalSearchEntry[]
  onOpenChange: (open: boolean) => void
  onSelectResult: (result: GlobalSearchResult) => void
}

export function GlobalSearchDialog({
  open,
  entries,
  onOpenChange,
  onSelectResult,
}: GlobalSearchDialogProps) {
  const { copy } = useI18n()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const results = useMemo(() => searchGlobalMessages(entries, deferredQuery), [entries, deferredQuery])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen) {
          setQuery('')
        }
      }}
    >
      <DialogContent className="max-w-3xl gap-0 overflow-hidden border-border/80 p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{copy.messages.globalSearch}</DialogTitle>
          <DialogDescription>{copy.messages.globalSearchDescription}</DialogDescription>
        </DialogHeader>
        <div className="border-b border-border px-5 py-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.messages.globalSearchPlaceholder}
              className="h-11 border-border/70 bg-[var(--chat)] pl-9 text-sm shadow-none"
            />
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto px-3 py-3">
          {results.length > 0 ? (
            <div className="space-y-1">
              {results.slice(0, 40).map((result) => (
                <button
                  key={`${result.roomId}:${result.messageId}`}
                  type="button"
                  className="flex w-full items-start gap-3 rounded-md border border-transparent px-3 py-3 text-left transition-colors hover:border-border hover:bg-[var(--panel-strong)]"
                  onClick={() => {
                    onSelectResult(result)
                    setQuery('')
                  }}
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--chat)] text-[var(--muted-foreground)]">
                    {result.source === 'archive' ? <Archive className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-foreground">{result.author}</span>
                      <span className="truncate text-[var(--muted-foreground)]">#{result.roomLabel}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-foreground/78">{result.preview}</p>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-[var(--muted-foreground)]">
                    <div>{result.timestamp}</div>
                    <div className="mt-1">{result.source === 'archive' ? copy.messages.globalSearchArchive : copy.messages.globalSearchLive}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center text-sm text-[var(--muted-foreground)]">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-[var(--chat)]">
                <Search className="h-4 w-4" />
              </div>
              <p>{query.trim() ? copy.messages.globalSearchEmpty : copy.messages.globalSearchIdle}</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-[var(--muted-foreground)]">
          <span>{copy.messages.globalSearchResultCount(results.length)}</span>
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => onOpenChange(false)}>
            {copy.messages.searchClose}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

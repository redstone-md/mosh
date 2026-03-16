import type { MouseEvent } from 'react'
import { Search } from 'lucide-react'

import { RuntimePanel } from './RuntimePanel'
import { WindowControls } from './WindowControls'
import type { DesktopSnapshot } from '../lib/schemas'
import { startDesktopWindowDrag, toggleDesktopWindowMaximize } from '../lib/desktopWindow'
import { Button } from './ui/button'
import { useI18n } from './I18nProvider'

type TitlebarProps = {
  runtime: DesktopSnapshot['runtime']
  onOpenGlobalSearch: () => void
  onToggleRuntime: () => void
  isBusy: boolean
  errorNote?: string
}

export function Titlebar({
  runtime,
  onOpenGlobalSearch,
  onToggleRuntime,
  isBusy,
  errorNote,
}: TitlebarProps) {
  const { copy } = useI18n()

  const handleDragStart = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    void startDesktopWindowDrag()
  }

  return (
    <div className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-border/30 bg-background px-3 select-none">
      <div
        className="flex min-w-[124px] items-center gap-2"
        onDoubleClick={() => void toggleDesktopWindowMaximize()}
        onMouseDown={handleDragStart}
      >
        <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-[var(--panel-strong)] text-[10px] font-semibold text-foreground/80">
          M
        </div>
        <div className="text-xs font-semibold tracking-[0.18em] text-foreground/72">
          MOSH
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className="h-6 min-w-12 flex-1 rounded-sm border border-border/50 bg-[var(--chat)]"
            onDoubleClick={() => void toggleDesktopWindowMaximize()}
            onMouseDown={handleDragStart}
          />
          <Button
            type="button"
            variant="ghost"
            className="h-8 shrink-0 gap-2 rounded-md border border-border/60 bg-[var(--chat)] px-2.5 text-[11px] font-medium text-[var(--muted-foreground)] hover:bg-[var(--panel-strong)] hover:text-foreground"
            onClick={onOpenGlobalSearch}
            title={copy.messages.globalSearch}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{copy.messages.globalSearchShortcut}</span>
          </Button>
        </div>
        <div className="shrink-0">
          <RuntimePanel
            state={runtime.state}
            summary={runtime.summary}
            route={runtime.route}
            natHint={runtime.natHint}
            sharedBridge={runtime.sharedBridge}
            isOnline={runtime.state === 'Runtime online'}
            errorNote={errorNote}
            onToggle={onToggleRuntime}
            isBusy={isBusy}
            compact={true}
          />
        </div>
        <div
          className="hidden h-6 min-w-12 flex-1 rounded-sm border border-border/50 bg-[var(--chat)] md:block"
          onDoubleClick={() => void toggleDesktopWindowMaximize()}
          onMouseDown={handleDragStart}
        />
      </div>

      <div className="flex items-center">
        <WindowControls className="flex items-center gap-0.5" />
      </div>
    </div>
  )
}

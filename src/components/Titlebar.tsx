import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Square, X, Maximize2 } from 'lucide-react'
import { RuntimePanel } from './RuntimePanel'
import type { DesktopSnapshot } from '../lib/schemas'

type TitlebarProps = {
  runtime: DesktopSnapshot['runtime']
  onToggleRuntime: () => void
  isBusy: boolean
  errorNote?: string
}

export function Titlebar({ runtime, onToggleRuntime, isBusy, errorNote }: TitlebarProps) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const checkMaximized = async () => {
      const appWindow = getCurrentWindow()
      const maximized = await appWindow.isMaximized()
      setIsMaximized(maximized)
    }
    checkMaximized()
    
    // In a real app we'd listen to resize events, but polling or just basic state works for now
    let interval = setInterval(checkMaximized, 500)
    return () => clearInterval(interval)
  }, [])

  const appWindow = getCurrentWindow()

  return (
    <div 
      data-tauri-drag-region 
      className="h-14 bg-background border-b border-border/20 flex items-center justify-between select-none px-4 flex-shrink-0"
    >
      <div className="flex items-center gap-4 pointer-events-none">
        <div className="font-bold tracking-widest text-sm text-foreground/80 flex items-center gap-2">
           <div className="w-2 h-2 rounded-full bg-primary/80 animate-pulse" />
           MOSH
        </div>
      </div>

      <div className="flex-1 flex justify-center items-center pointer-events-none px-4">
        <div className="pointer-events-auto max-w-full">
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
      </div>

      <div className="flex items-center gap-1 pointer-events-auto">
        <button
          className="p-2 hover:bg-muted/50 rounded-lg text-foreground/50 hover:text-foreground transition-colors"
          onClick={() => appWindow.minimize()}
          title="Minimize"
        >
          <Minus size={16} />
        </button>
        <button
          className="p-2 hover:bg-muted/50 rounded-lg text-foreground/50 hover:text-foreground transition-colors"
          onClick={async () => {
            await appWindow.toggleMaximize()
          }}
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Square size={14} /> : <Maximize2 size={16} />}
        </button>
        <button
          className="p-2 hover:bg-red-500/10 rounded-lg text-foreground/50 hover:text-red-500 transition-colors"
          onClick={() => appWindow.close()}
          title="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

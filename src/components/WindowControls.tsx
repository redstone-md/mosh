import { useEffect, useState } from 'react'
import { Maximize2, Minus, Square, X } from 'lucide-react'

import {
  hideWindowToTray,
  minimizeDesktopWindow,
  readDesktopWindowState,
  toggleDesktopWindowMaximize,
} from '../lib/desktopWindow'
import { isTauriEnvironment } from '../lib/tauriEnv'

type WindowControlsProps = {
  className?: string
}

export function WindowControls({ className }: WindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false)
  const interactive = isTauriEnvironment()

  useEffect(() => {
    if (!interactive) {
      return
    }

    const syncMaximized = async () => {
      const state = await readDesktopWindowState()
      setIsMaximized(state.maximized)
    }

    void syncMaximized()
    return undefined
  }, [interactive])

  if (!interactive) {
    return null
  }

  return (
    <div className={className}>
      <button
        className="p-2 text-foreground/50 transition-colors hover:bg-muted/50 hover:text-foreground"
        onClick={() => void minimizeDesktopWindow()}
        title="Minimize"
      >
        <Minus size={16} />
      </button>
      <button
        className="p-2 text-foreground/50 transition-colors hover:bg-muted/50 hover:text-foreground"
        onClick={() => {
          void toggleDesktopWindowMaximize().then(async () => {
            const state = await readDesktopWindowState()
            setIsMaximized(state.maximized)
          })
        }}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? <Square size={14} /> : <Maximize2 size={16} />}
      </button>
      <button
        className="p-2 text-foreground/50 transition-colors hover:bg-red-500/10 hover:text-red-500"
        onClick={() => void hideWindowToTray()}
        title="Hide to tray"
      >
        <X size={16} />
      </button>
    </div>
  )
}

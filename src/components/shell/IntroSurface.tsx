import { Titlebar } from '../Titlebar'
import { ShellToaster } from '../ShellToaster'
import { MoshIntro } from './MoshIntro'
import type { RuntimeStatus } from '../../lib/schemas'

type IntroSurfaceProps = {
  runtime: RuntimeStatus
  isBusy: boolean
  errorNote?: string
  onToggleRuntime: () => void
  onComplete: () => void
}

export function IntroSurface({
  runtime,
  isBusy,
  errorNote,
  onToggleRuntime,
  onComplete,
}: IntroSurfaceProps) {
  return (
    <main className="flex h-screen flex-col bg-[var(--app)] text-foreground">
      <ShellToaster />
      <Titlebar
        runtime={runtime}
        onToggleRuntime={onToggleRuntime}
        isBusy={isBusy}
        errorNote={errorNote}
      />
      <MoshIntro onComplete={onComplete} />
    </main>
  )
}

import { Power, PowerOff } from 'lucide-react'

type RuntimePanelProps = {
  state: string
  summary: string
  route: string
  natHint: string
  sharedBridge: string
  isOnline: boolean
  errorNote?: string
  onToggle: () => void
  isBusy: boolean
}

export function RuntimePanel({
  state,
  summary,
  route,
  natHint,
  sharedBridge,
  isOnline,
  errorNote,
  onToggle,
  isBusy,
}: RuntimePanelProps) {
  return (
    <section className="bg-primary/5 border-b border-primary/10 px-4 py-2 flex items-center justify-between gap-4 shrink-0 text-sm">
      <div className="flex items-center gap-6 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-primary shadow-[0_0_0_4px_rgba(90,198,136,0.2)]' : 'bg-foreground/30'}`} />
          <strong className="whitespace-nowrap">{state}</strong>
          <span className="text-foreground/50 truncate hidden sm:inline-block">{summary}</span>
        </div>
        <div className="hidden md:flex gap-2 text-xs font-mono">
          <span className="px-2 py-0.5 rounded-full bg-background border border-border/50 text-foreground/70">{natHint}</span>
          <span className="px-2 py-0.5 rounded-full bg-background border border-border/50 text-foreground/70">{route}</span>
          <span className="px-2 py-0.5 rounded-full bg-background border border-border/50 text-foreground/70">{summarizeBridge(sharedBridge)}</span>
        </div>
        {errorNote ? <p className="text-red-400 m-0">{errorNote}</p> : null}
      </div>
      <button 
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition-colors ${isOnline ? 'border-primary/30 text-primary hover:bg-primary/10' : 'border-border text-foreground/70 hover:bg-white/5'} disabled:opacity-50`}
        onClick={onToggle} 
        disabled={isBusy}
      >
        {isOnline ? <PowerOff size={14} /> : <Power size={14} />}
        <span>{isBusy ? '...' : isOnline ? 'Stop' : 'Start'}</span>
      </button>
    </section>
  )
}

function summarizeBridge(value: string): string {
  const marker = 'Loaded from '
  if (!value.startsWith(marker)) {
    return value
  }
  const path = value.slice(marker.length)
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() ?? value
}


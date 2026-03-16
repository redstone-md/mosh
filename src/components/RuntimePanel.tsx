import {
  CircleDot,
  Cloud,
  Network,
  Power,
  PowerOff,
  TriangleAlert,
  Waypoints,
} from 'lucide-react'
import { useI18n } from './I18nProvider'
import { localizeRuntimeState } from '../lib/i18n'

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
  compact?: boolean
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
  compact = false,
}: RuntimePanelProps) {
  const { copy } = useI18n()
  const localizedState = localizeRuntimeState(copy, state)

  if (compact) {
    return (
      <div className="flex items-center gap-1 rounded-md border border-border/70 bg-[var(--panel)] px-1.5 py-1">
        <IndicatorButton
          icon={CircleDot}
          title={`${localizedState} • ${summary}`}
          active={isOnline}
          className="text-primary"
        />
        <IndicatorButton icon={Cloud} title={natHint} active={hasTransportState(natHint)} />
        <IndicatorButton icon={Waypoints} title={route} active={hasTransportState(route)} />
        <IndicatorButton
          icon={Network}
          title={summarizeBridge(sharedBridge)}
          active={hasTransportState(sharedBridge)}
        />
        {errorNote ? (
          <IndicatorButton icon={TriangleAlert} title={errorNote} active={false} className="text-[var(--danger)]" />
        ) : null}
        <button
          className={`ml-1 flex h-7 w-7 items-center justify-center rounded border transition-colors ${
            isOnline
              ? 'border-primary/30 text-primary hover:bg-primary/10'
              : 'border-border text-foreground/65 hover:bg-[var(--panel-hover)]'
          } disabled:opacity-50`}
          onClick={onToggle}
          disabled={isBusy}
          title={isOnline ? copy.runtime.stop : copy.runtime.start}
          type="button"
        >
          {isOnline ? <PowerOff size={12} /> : <Power size={12} />}
        </button>
      </div>
    )
  }

  return (
    <section className="bg-primary/5 border-b border-primary/10 px-4 py-2 flex items-center justify-between gap-4 shrink-0 text-sm">
      <div className="flex items-center gap-6 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-primary shadow-[0_0_0_4px_rgba(90,198,136,0.2)]' : 'bg-foreground/30'}`} />
          <strong className="whitespace-nowrap">{localizedState}</strong>
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
        <span>{isBusy ? '...' : isOnline ? copy.runtime.stop : copy.runtime.start}</span>
      </button>
    </section>
  )
}

type IndicatorButtonProps = {
  icon: typeof CircleDot
  title: string
  active: boolean
  className?: string
}

function IndicatorButton({ icon: Icon, title, active, className }: IndicatorButtonProps) {
  return (
    <span
      className={`flex h-7 w-7 items-center justify-center rounded border text-[11px] ${
        active
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-border/80 bg-[var(--chat)] text-foreground/55'
      } ${className ?? ''}`}
      title={title}
    >
      <Icon size={13} />
    </span>
  )
}

function hasTransportState(value: string): boolean {
  return !/inactive|offline|unknown|disabled|no active/i.test(value)
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

import type { PeerSummary } from '../lib/schemas'

type PeerPanelProps = {
  peers: PeerSummary[]
  onOpenDirectRoom: (target: string) => void
}

export function PeerPanel({ peers, onOpenDirectRoom }: PeerPanelProps) {
  return (
    <aside className="w-80 shrink-0 border-l border-border/10 bg-muted/10 flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-border/10 shrink-0 bg-background/50 backdrop-blur-sm">
        <p className="text-[10px] uppercase tracking-widest text-primary font-bold mb-1">Channel</p>
        <h2 className="text-lg font-bold">Participants</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {peers.length > 0 ? (
          peers.map((peer) => (
            <article className="bg-background/40 border border-border/20 rounded-xl p-3 flex flex-col gap-3" key={peer.id}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 text-primary-foreground font-bold text-sm border border-primary/20">
                  {avatarLabel(peer.displayName)}
                </div>
                <div className="flex flex-col min-w-0">
                  <strong className="text-sm truncate text-foreground">{peer.displayName}</strong>
                  <span className="text-[10px] uppercase tracking-wider text-foreground/50">{peer.status}</span>
                </div>
              </div>
              <p className="text-xs font-mono text-foreground/60 truncate">{peer.route}</p>
              <div className="flex flex-wrap gap-2 text-[10px]">
                <span className="px-2 py-0.5 rounded bg-muted/50 border border-border/30 text-foreground/70">{peer.latency}</span>
                <span className="px-2 py-0.5 rounded bg-muted/50 border border-border/30 text-foreground/70 truncate max-w-full">{peer.rooms.join(', ')}</span>
              </div>
              {peer.status !== 'self' ? (
                <button
                  className="mt-1 w-full bg-secondary text-foreground text-xs font-bold py-2 rounded-lg hover:bg-secondary/80 border border-border/20 transition-all"
                  type="button"
                  onClick={() => onOpenDirectRoom(peer.displayName)}
                >
                  Direct message
                </button>
              ) : null}
            </article>
          ))
        ) : (
          <div className="border border-dashed border-border/20 rounded-xl p-4 text-center space-y-2">
            <strong className="block text-sm text-foreground/80">No participants yet</strong>
            <p className="text-xs text-foreground/50">When peers join this channel, they will appear here.</p>
          </div>
        )}
      </div>
    </aside>
  )
}

function avatarLabel(displayName: string): string {
  return displayName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() ?? '')
    .join('')
}


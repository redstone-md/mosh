import type { PeerSummary } from '../lib/schemas'
import { MessageSquare, Signal, Activity } from 'lucide-react'

type PeerPanelProps = {
  peers: PeerSummary[]
  onOpenDirectRoom: (target: string) => void
}

export function PeerPanel({ peers, onOpenDirectRoom }: PeerPanelProps) {
  return (
    <aside className="w-72 shrink-0 border-l border-border/20 bg-background/50 flex flex-col h-full overflow-hidden">
      <div className="px-5 py-4 border-b border-border/20 shrink-0 bg-muted/20 backdrop-blur-md flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold tracking-tight text-foreground/90">Participants</h2>
          <p className="text-[11px] font-medium text-foreground/50">{peers.length} Online</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {peers.length > 0 ? (
          peers.map((peer) => {
            const isSelf = peer.status === 'self'
            const displayName = isSelf ? peer.displayName.replace(' (you)', '') : peer.displayName

            return (
              <div
                key={peer.id}
                className="group relative flex items-center gap-3 p-2 rounded-xl hover:bg-muted/50 transition-colors cursor-pointer"
              >
                <div className="relative">
                  <div className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full bg-secondary text-foreground font-bold text-xs shadow-sm ring-1 ring-border/50 group-hover:ring-border">
                    {avatarLabel(displayName)}
                  </div>
                  <div
                    className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-background ${isSelf ? 'bg-primary' : 'bg-primary/80'}`}
                  />
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm font-medium truncate text-foreground/90 group-hover:text-foreground transition-colors">
                      {displayName}
                      {isSelf && (
                        <span className="ml-1.5 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-md font-bold uppercase tracking-widest">
                          You
                        </span>
                      )}
                    </strong>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-foreground/40 flex items-center gap-1">
                      <Activity size={10} />
                      {peer.latency}
                    </span>
                    <span className="text-[11px] text-foreground/30 truncate max-w-[80px]">
                      {peer.route.split(':')[0] || peer.route}
                    </span>
                  </div>
                </div>

                {!isSelf && (
                  <button
                    className="opacity-0 group-hover:opacity-100 absolute right-2 p-1.5 bg-background border border-border/50 text-foreground/70 hover:text-primary rounded-lg shadow-sm transition-all"
                    title="Direct Message"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenDirectRoom(displayName)
                    }}
                  >
                    <MessageSquare size={14} />
                  </button>
                )}
              </div>
            )
          })
        ) : (
          <div className="flex flex-col items-center justify-center h-40 text-center space-y-3 opacity-50">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Signal size={24} />
            </div>
            <div>
              <strong className="block text-sm">No peers visible</strong>
              <p className="text-xs max-w-[180px] mx-auto">Peers in this channel will appear here.</p>
            </div>
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

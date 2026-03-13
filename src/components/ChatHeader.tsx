import { Menu, Users, Wifi, WifiOff, Hash, Settings, Info } from 'lucide-react'
import type { RoomSummary, RuntimeStatus } from '../lib/schemas'

type ChatHeaderProps = {
  room: RoomSummary | undefined
  peers: unknown[]
  runtime: RuntimeStatus
  onToggleSidebar: () => void
}

export function ChatHeader({ room, peers, runtime, onToggleSidebar }: ChatHeaderProps) {
  const isOnline = runtime.state === 'Runtime online'

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b border-border/20 bg-muted/10 backdrop-blur-xl sticky top-0 z-20 shrink-0 shadow-sm">
      <div className="flex items-center gap-4">
        <button
          className="lg:hidden p-2.5 rounded-xl hover:bg-background border border-transparent hover:border-border/50 text-foreground/60 hover:text-foreground transition-all shadow-sm"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          <Menu size={20} />
        </button>
        
        <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-background/80 border border-border/50 flex items-center justify-center text-foreground/50 shadow-sm">
                {room?.kind === 'system' ? <Settings size={20} /> : <Hash size={20} />}
            </div>
            
            <div className="flex flex-col justify-center">
                <div className="flex items-center gap-2">
                    <h1 className="font-bold text-[17px] tracking-tight text-foreground/90">
                    {room?.label ?? 'Select a room'}
                    </h1>
                    {room?.kind === 'system' && (
                    <span className="text-[9px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                        System
                    </span>
                    )}
                </div>
                <div className="flex items-center gap-3 text-[11px] font-medium text-foreground/40 mt-0.5">
                    <div className="flex items-center gap-1.5 bg-background/50 px-2 py-0.5 rounded-md border border-border/30">
                        <Users size={12} />
                        <span>{peers.length} active peers</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-background/50 px-2 py-0.5 rounded-md border border-border/30">
                    {isOnline ? (
                        <>
                        <Wifi size={12} className="text-primary" />
                        <span className="text-primary/80">Network Connected</span>
                        </>
                    ) : (
                        <>
                        <WifiOff size={12} className="text-red-400" />
                        <span className="text-red-400/80">Offline</span>
                        </>
                    )}
                    </div>
                </div>
            </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className="p-2.5 text-foreground/40 hover:text-foreground hover:bg-background rounded-xl transition-colors border border-transparent hover:border-border/50" title="Channel Info">
            <Info size={20} />
        </button>
      </div>
    </header>
  )
}

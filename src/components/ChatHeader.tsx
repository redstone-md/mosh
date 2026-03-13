import { Menu, Users, Wifi, WifiOff } from 'lucide-react'
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
    <header className="h-16 flex items-center justify-between px-6 border-b border-border/10 bg-background/50 backdrop-blur-md sticky top-0 z-20">
      <div className="flex items-center gap-4">
        <button
          className="lg:hidden p-2 rounded-lg hover:bg-white/5 text-foreground/60 transition-colors"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          <Menu size={20} />
        </button>
        
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-lg tracking-tight">
              {room?.label ?? 'Select a room'}
            </h1>
            {room?.kind === 'system' && (
              <span className="text-[10px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                System
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-foreground/30">
            <div className="flex items-center gap-1">
              <Users size={12} />
              <span>{peers.length} active</span>
            </div>
            <div className="flex items-center gap-1">
              {isOnline ? (
                <>
                  <Wifi size={12} className="text-primary" />
                  <span className="text-primary/60">Connected</span>
                </>
              ) : (
                <>
                  <WifiOff size={12} className="text-red-400" />
                  <span className="text-red-400/60">Offline</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Placeholder for future header actions */}
      </div>
    </header>
  )
}

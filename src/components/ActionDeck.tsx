type ActionDeckProps = {
  appName: string
  version: string
  branch: string
  stage: string
  roomDraft: string
  peerDraft: string
  directDraft: string
  onRoomDraftChange: (value: string) => void
  onPeerDraftChange: (value: string) => void
  onDirectDraftChange: (value: string) => void
  onJoinRoom: () => void
  onConnectPeer: () => void
  onOpenDirectRoom: () => void
  busyAction?: string
  errorNote?: string
}

export function ActionDeck({
  appName,
  version,
  branch,
  stage,
  roomDraft,
  peerDraft,
  directDraft,
  onRoomDraftChange,
  onPeerDraftChange,
  onDirectDraftChange,
  onJoinRoom,
  onConnectPeer,
  onOpenDirectRoom,
  busyAction,
  errorNote,
}: ActionDeckProps) {
  return (
    <section className="bg-muted/30 border border-border/20 rounded-3xl p-6 shadow-xl space-y-6">
      <header className="border-b border-border/10 pb-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-primary font-bold mb-1">Action deck</p>
          <h2 className="text-xl font-bold">{appName}</h2>
        </div>
      </header>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2 py-1 rounded border border-border/20 bg-background/50 text-foreground/60">{version}</span>
        <span className="px-2 py-1 rounded border border-border/20 bg-background/50 text-foreground/60">{branch}</span>
        <span className="px-2 py-1 rounded border border-border/20 bg-background/50 text-foreground/60">{stage}</span>
      </div>
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-end gap-3">
          <label className="flex flex-col gap-1.5 flex-1 w-full">
            <span className="text-sm font-medium text-foreground/60">Join room</span>
            <input
              className="w-full bg-background border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              value={roomDraft}
              onChange={(event) => onRoomDraftChange(event.target.value)}
              placeholder="lobby"
            />
          </label>
          <button 
            className="w-full sm:w-auto bg-primary/10 text-primary border border-primary/20 text-sm font-bold py-2 px-4 rounded-xl hover:bg-primary/20 transition-all disabled:opacity-50 h-[38px]" 
            onClick={onJoinRoom} 
            type="button"
          >
            {busyAction === 'join' ? 'Joining...' : 'Subscribe'}
          </button>
        </div>
        <div className="flex flex-col sm:flex-row items-end gap-3">
          <label className="flex flex-col gap-1.5 flex-1 w-full">
            <span className="text-sm font-medium text-foreground/60">Connect peer</span>
            <input
              className="w-full bg-background border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              value={peerDraft}
              onChange={(event) => onPeerDraftChange(event.target.value)}
              placeholder="host:port"
            />
          </label>
          <button 
            className="w-full sm:w-auto bg-secondary text-foreground text-sm font-bold py-2 px-4 rounded-xl hover:bg-secondary/80 border border-border/20 transition-all disabled:opacity-50 h-[38px]" 
            onClick={onConnectPeer} 
            type="button"
          >
            {busyAction === 'connect' ? 'Connecting...' : 'Connect'}
          </button>
        </div>
        <div className="flex flex-col sm:flex-row items-end gap-3">
          <label className="flex flex-col gap-1.5 flex-1 w-full">
            <span className="text-sm font-medium text-foreground/60">Open direct room</span>
            <input
              className="w-full bg-background border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              value={directDraft}
              onChange={(event) => onDirectDraftChange(event.target.value)}
              placeholder="nickname or peer id"
            />
          </label>
          <button 
            className="w-full sm:w-auto bg-secondary text-foreground text-sm font-bold py-2 px-4 rounded-xl hover:bg-secondary/80 border border-border/20 transition-all disabled:opacity-50 h-[38px]" 
            onClick={onOpenDirectRoom} 
            type="button"
          >
            {busyAction === 'dm' ? 'Opening...' : 'Open DM'}
          </button>
        </div>
        <div className="flex flex-col gap-2 pt-2 border-t border-border/10 text-xs text-foreground/40">
          <span>Room messages use the shared chat payload format.</span>
          <span>Presence and direct-room invites flow over the control channel.</span>
        </div>
      </div>
      {errorNote ? <p className="bg-red-500/10 text-red-400 text-sm p-3 rounded-lg border border-red-500/20">{errorNote}</p> : null}
    </section>
  )
}


type QuickActionsPanelProps = {
  peerDraft: string
  directDraft: string
  busyAction?: string
  errorNote?: string
  onPeerDraftChange: (value: string) => void
  onDirectDraftChange: (value: string) => void
  onConnectPeer: () => void
  onOpenDirectRoom: () => void
}

export function QuickActionsPanel({
  peerDraft,
  directDraft,
  busyAction,
  errorNote,
  onPeerDraftChange,
  onDirectDraftChange,
  onConnectPeer,
  onOpenDirectRoom,
}: QuickActionsPanelProps) {
  return (
    <section className="bg-muted/30 border border-border/20 rounded-3xl p-6 shadow-xl space-y-6">
      <header className="border-b border-border/10 pb-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-primary font-bold mb-1">Quick actions</p>
          <h2 className="text-xl font-bold">Connect and direct chat</h2>
        </div>
      </header>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground/60">Connect peer</span>
            <input
              className="w-full bg-background border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              value={peerDraft}
              onChange={(event) => onPeerDraftChange(event.target.value)}
              placeholder="host:port"
            />
          </label>
          <button
            className="bg-secondary text-foreground text-sm font-bold py-2 px-4 rounded-xl hover:bg-secondary/80 border border-border/20 transition-all disabled:opacity-50 mt-auto"
            onClick={onConnectPeer}
            type="button"
          >
            {busyAction === 'connect' ? 'Connecting...' : 'Connect'}
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground/60">Open direct message</span>
            <input
              className="w-full bg-background border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              value={directDraft}
              onChange={(event) => onDirectDraftChange(event.target.value)}
              placeholder="nickname or peer id"
            />
          </label>
          <button
            className="bg-secondary text-foreground text-sm font-bold py-2 px-4 rounded-xl hover:bg-secondary/80 border border-border/20 transition-all disabled:opacity-50 mt-auto"
            onClick={onOpenDirectRoom}
            type="button"
          >
            {busyAction === 'dm' ? 'Opening...' : 'Open DM'}
          </button>
        </div>
      </div>
      {errorNote ? (
        <p className="bg-red-500/10 text-red-400 text-sm p-3 rounded-lg border border-red-500/20">{errorNote}</p>
      ) : null}
    </section>
  )
}

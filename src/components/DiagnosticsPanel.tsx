import type { RuntimeDiagnostics } from '../lib/schemas'

type DiagnosticsPanelProps = {
  diagnostics: RuntimeDiagnostics
}

export function DiagnosticsPanel({ diagnostics }: DiagnosticsPanelProps) {
  return (
    <section className="bg-muted/30 border border-border/20 rounded-3xl p-6 shadow-xl space-y-6">
      <header className="border-b border-border/10 pb-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-primary font-bold mb-1">Diagnostics</p>
          <h2 className="text-xl font-bold">Runtime view</h2>
        </div>
      </header>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-background/40 border border-border/20 rounded-xl p-4 flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-foreground/40 font-bold">Nickname</span>
          <strong className="text-foreground">{diagnostics.configuredNickname}</strong>
          <p className="text-xs text-foreground/50">identity shown in chat presence</p>
        </div>
        <div className="bg-background/40 border border-border/20 rounded-xl p-4 flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-foreground/40 font-bold">Configured mesh</span>
          <strong className="text-foreground">{diagnostics.configuredMeshId}</strong>
          <p className="text-xs text-foreground/50">
            room {diagnostics.initialRoom} | port {diagnostics.configuredListenPort}
          </p>
        </div>
        <div className="bg-background/40 border border-border/20 rounded-xl p-4 flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-foreground/40 font-bold">Bootstrap</span>
          <strong className="text-foreground">{diagnostics.trackerMode}</strong>
          <p className="text-xs text-foreground/50">LAN discovery {diagnostics.lanDiscovery}</p>
        </div>
        <div className="bg-background/40 border border-border/20 rounded-xl p-4 flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-foreground/40 font-bold">Active runtime</span>
          <strong className="text-foreground">{diagnostics.activeMeshId}</strong>
          <p className="text-xs text-foreground/50">listen {diagnostics.activeListenPort}</p>
        </div>
        <div className="bg-background/40 border border-border/20 rounded-xl p-4 flex flex-col gap-1.5 xl:col-span-2">
          <span className="text-[10px] uppercase tracking-widest text-foreground/40 font-bold">Peer state</span>
          <strong className="text-foreground">
            {diagnostics.peerCount} peers / {diagnostics.channelCount} channels
          </strong>
          <p className="text-xs text-foreground/50">
            {diagnostics.supernodeReady ? 'Relay candidate ready' : 'Relay candidate offline'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2.5 py-1 rounded-full border border-border/20 bg-background/50 text-foreground/60">
          startup peer {diagnostics.startupPeer === 'not set' ? 'not configured' : diagnostics.startupPeer}
        </span>
        {diagnostics.activeChannels.length > 0 ? (
          diagnostics.activeChannels.map((channel) => (
            <span
              key={channel}
              className="px-2.5 py-1 rounded-full border border-primary/20 bg-primary/10 text-primary"
            >
              #{channel}
            </span>
          ))
        ) : (
          <span className="px-2.5 py-1 rounded-full border border-border/20 bg-background/50 text-foreground/60">
            No active subscriptions yet
          </span>
        )}
      </div>
    </section>
  )
}

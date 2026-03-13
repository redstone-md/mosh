type RuntimeSetupPanelProps = {
  nickname: string
  meshId: string
  listenPort: string
  initialRoom: string
  startupPeer: string
  trackerMode: 'default' | 'disabled'
  lanDiscoveryEnabled: boolean
  configPreview: string
  errorNote?: string
  isSaving: boolean
  primaryActionLabel?: string
  secondaryActionLabel?: string
  onNicknameChange: (value: string) => void
  onMeshIdChange: (value: string) => void
  onListenPortChange: (value: string) => void
  onInitialRoomChange: (value: string) => void
  onStartupPeerChange: (value: string) => void
  onTrackerModeChange: (value: 'default' | 'disabled') => void
  onLanDiscoveryChange: (value: boolean) => void
  onSave: () => void
  onSecondaryAction?: () => void
}

export function RuntimeSetupPanel({
  nickname,
  meshId,
  listenPort,
  initialRoom,
  startupPeer,
  trackerMode,
  lanDiscoveryEnabled,
  configPreview,
  errorNote,
  isSaving,
  primaryActionLabel,
  secondaryActionLabel,
  onNicknameChange,
  onMeshIdChange,
  onListenPortChange,
  onInitialRoomChange,
  onStartupPeerChange,
  onTrackerModeChange,
  onLanDiscoveryChange,
  onSave,
  onSecondaryAction,
}: RuntimeSetupPanelProps) {
  const inputClasses = "w-full bg-background border border-border/50 rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
  const labelClasses = "block text-sm font-medium text-foreground/60 mb-1.5"

  return (
    <section className="bg-muted/30 border border-border/20 rounded-3xl p-8 backdrop-blur-sm shadow-xl space-y-8">
      <header className="border-b border-border/10 pb-6">
        <p className="text-xs uppercase tracking-widest text-primary font-bold mb-1">Runtime setup</p>
        <h2 className="text-2xl font-bold">Chat bootstrap</h2>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
        <div>
          <label className={labelClasses}>Nickname</label>
          <input
            className={inputClasses}
            value={nickname}
            onChange={(event) => onNicknameChange(event.target.value)}
            placeholder="operator"
          />
        </div>
        <div>
          <label className={labelClasses}>Mesh ID</label>
          <input
            className={inputClasses}
            value={meshId}
            onChange={(event) => onMeshIdChange(event.target.value)}
            placeholder="mosh-chat"
          />
        </div>
        <div>
          <label className={labelClasses}>Listen port</label>
          <input
            className={inputClasses}
            value={listenPort}
            onChange={(event) => onListenPortChange(event.target.value)}
            placeholder="0"
            inputMode="numeric"
          />
        </div>
        <div>
          <label className={labelClasses}>Initial room</label>
          <input
            className={inputClasses}
            value={initialRoom}
            onChange={(event) => onInitialRoomChange(event.target.value)}
            placeholder="lobby"
          />
        </div>
        <div>
          <label className={labelClasses}>Startup peer</label>
          <input
            className={inputClasses}
            value={startupPeer}
            onChange={(event) => onStartupPeerChange(event.target.value)}
            placeholder="host:port"
          />
        </div>
        <div>
          <label className={labelClasses}>Tracker bootstrap</label>
          <select
            className={inputClasses}
            value={trackerMode}
            onChange={(event) =>
              onTrackerModeChange(event.target.value as 'default' | 'disabled')
            }
          >
            <option value="default">Use built-in trackers</option>
            <option value="disabled">Disable trackers</option>
          </select>
        </div>
        <div className="md:col-span-2 flex items-center gap-3 py-2">
          <input
            type="checkbox"
            id="lan-discovery"
            className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50"
            checked={lanDiscoveryEnabled}
            onChange={(event) => onLanDiscoveryChange(event.target.checked)}
          />
          <label htmlFor="lan-discovery" className="text-sm text-foreground/80 cursor-pointer select-none">
            Allow LAN discovery beacons
          </label>
        </div>
      </div>

      <div className="bg-black/40 rounded-xl p-6 border border-border/10">
        <p className="text-xs uppercase tracking-widest text-foreground/40 font-bold mb-3">Config preview</p>
        <pre className="text-xs font-mono text-primary/80 overflow-x-auto">{configPreview}</pre>
      </div>

      {errorNote ? (
        <p className="bg-red-500/10 text-red-400 text-sm p-4 rounded-lg border border-red-500/20">
          {errorNote}
        </p>
      ) : null}

      <div className="flex flex-col sm:flex-row gap-4 pt-4">
        <button 
          className="flex-1 bg-primary text-background font-bold py-3 px-6 rounded-xl hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onSave} 
          disabled={isSaving}
        >
          {primaryActionLabel ?? (isSaving ? 'Saving...' : 'Apply settings')}
        </button>
        {onSecondaryAction ? (
          <button
            className="flex-1 bg-secondary text-foreground font-bold py-3 px-6 rounded-xl hover:bg-secondary/80 border border-border/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onSecondaryAction}
            disabled={isSaving}
            type="button"
          >
            {secondaryActionLabel ?? 'Cancel'}
          </button>
        ) : null}
      </div>
    </section>
  )
}

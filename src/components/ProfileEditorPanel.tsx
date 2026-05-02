type ProfileEditorPanelProps = {
  nickname: string
  avatarPreviewUrl: string | null
  avatarFileName: string | null
  meshId: string
  initialRoom: string
  startupPeer: string
  listenPort: string
  trackerMode: 'default' | 'disabled'
  lanDiscoveryEnabled: boolean
  configPreview: string
  errorNote?: string
  isSaving: boolean
  onAvatarChange: (file: File | null) => void
  onNicknameChange: (value: string) => void
  onMeshIdChange: (value: string) => void
  onInitialRoomChange: (value: string) => void
  onStartupPeerChange: (value: string) => void
  onListenPortChange: (value: string) => void
  onTrackerModeChange: (value: 'default' | 'disabled') => void
  onLanDiscoveryChange: (value: boolean) => void
  onSave: () => void
}

export function ProfileEditorPanel({
  nickname,
  avatarPreviewUrl,
  avatarFileName,
  meshId,
  initialRoom,
  startupPeer,
  listenPort,
  trackerMode,
  lanDiscoveryEnabled,
  configPreview,
  errorNote,
  isSaving,
  onAvatarChange,
  onNicknameChange,
  onMeshIdChange,
  onInitialRoomChange,
  onStartupPeerChange,
  onListenPortChange,
  onTrackerModeChange,
  onLanDiscoveryChange,
  onSave,
}: ProfileEditorPanelProps) {
  const inputClasses =
    'w-full bg-background border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all'
  const labelClasses = 'block text-sm font-medium text-foreground/60 mb-1.5'

  return (
    <section className="space-y-8 pb-8">
      <header className="border-b border-border/10 pb-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-primary font-bold mb-1">Edit profile</p>
          <h2 className="text-2xl font-bold">Identity and bootstrap</h2>
        </div>
      </header>

      <div className="flex items-center gap-6 p-6 bg-muted/30 border border-border/20 rounded-2xl">
        <div className="w-20 h-20 shrink-0">
          {avatarPreviewUrl ? (
            <img
              className="w-full h-full object-cover rounded-2xl border border-border/50"
              src={avatarPreviewUrl}
              alt="Profile preview"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 text-primary-foreground font-bold text-xl border border-primary/20">
              {avatarLabel(nickname)}
            </div>
          )}
        </div>
        <div>
          <strong className="text-xl block mb-1">{nickname || 'operator'}</strong>
          <p className="text-sm text-foreground/60 max-w-md mb-2">
            Live preview of how your identity appears in the channel list and message stream.
          </p>
          <p className="text-xs text-foreground/40">
            {avatarFileName ? `Photo ready: ${avatarFileName}` : 'No profile photo selected yet.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
        <div>
          <label className={labelClasses}>Profile photo</label>
          <input
            className="block w-full text-sm text-foreground/60 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 transition-all cursor-pointer"
            type="file"
            accept="image/*"
            onChange={(event) => onAvatarChange(event.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <label className={labelClasses}>Display name</label>
          <input className={inputClasses} value={nickname} onChange={(event) => onNicknameChange(event.target.value)} />
        </div>
        <div>
          <label className={labelClasses}>Mesh ID</label>
          <input className={inputClasses} value={meshId} onChange={(event) => onMeshIdChange(event.target.value)} />
        </div>
        <div>
          <label className={labelClasses}>Initial room</label>
          <input
            className={inputClasses}
            value={initialRoom}
            onChange={(event) => onInitialRoomChange(event.target.value)}
          />
        </div>
        <div>
          <label className={labelClasses}>Startup peer</label>
          <input
            className={inputClasses}
            value={startupPeer}
            onChange={(event) => onStartupPeerChange(event.target.value)}
            placeholder="optional host:port"
          />
        </div>
        <div>
          <label className={labelClasses}>Listen port</label>
          <input
            className={inputClasses}
            value={listenPort}
            onChange={(event) => onListenPortChange(event.target.value)}
            inputMode="numeric"
          />
        </div>
        <div>
          <label className={labelClasses}>Bootstrap mode</label>
          <select
            className={inputClasses}
            value={trackerMode}
            onChange={(event) => onTrackerModeChange(event.target.value as 'default' | 'disabled')}
          >
            <option value="default">Use built-in trackers</option>
            <option value="disabled">Disable trackers</option>
          </select>
        </div>
        <div className="md:col-span-2 flex items-center gap-3 pt-2">
          <input
            type="checkbox"
            id="lan-discovery-profile"
            className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50"
            checked={lanDiscoveryEnabled}
            onChange={(event) => onLanDiscoveryChange(event.target.checked)}
          />
          <label htmlFor="lan-discovery-profile" className="text-sm text-foreground/80 cursor-pointer select-none">
            Enable LAN discovery for nearby peers
          </label>
        </div>
      </div>

      <div className="bg-black/40 rounded-xl p-6 border border-border/10">
        <p className="text-xs uppercase tracking-widest text-foreground/40 font-bold mb-3">Config preview</p>
        <pre className="text-xs font-mono text-primary/80 overflow-x-auto">{configPreview}</pre>
      </div>

      {errorNote ? (
        <p className="bg-red-500/10 text-red-400 text-sm p-4 rounded-lg border border-red-500/20">{errorNote}</p>
      ) : null}

      <div className="pt-4">
        <button
          className="bg-primary text-background font-bold py-3 px-8 rounded-xl hover:bg-primary/90 transition-all disabled:opacity-50"
          type="button"
          onClick={onSave}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save profile'}
        </button>
      </div>
    </section>
  )
}

function avatarLabel(nickname: string): string {
  const trimmed = nickname.trim()
  if (!trimmed) {
    return 'MC'
  }
  return trimmed
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() ?? '')
    .join('')
}

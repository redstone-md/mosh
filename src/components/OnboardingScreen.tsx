import { RuntimeSetupPanel } from './RuntimeSetupPanel'
import { Rocket, Shield, Zap } from 'lucide-react'

type OnboardingScreenProps = {
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
  onNicknameChange: (value: string) => void
  onMeshIdChange: (value: string) => void
  onListenPortChange: (value: string) => void
  onInitialRoomChange: (value: string) => void
  onStartupPeerChange: (value: string) => void
  onTrackerModeChange: (value: 'default' | 'disabled') => void
  onLanDiscoveryChange: (value: boolean) => void
  onSave: () => void
  onSkip: () => void
}

export function OnboardingScreen({
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
  onNicknameChange,
  onMeshIdChange,
  onListenPortChange,
  onInitialRoomChange,
  onStartupPeerChange,
  onTrackerModeChange,
  onLanDiscoveryChange,
  onSave,
  onSkip,
}: OnboardingScreenProps) {
  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6 sm:p-12 overflow-y-auto">
      <div className="w-full max-w-4xl space-y-12 py-12">
        <header className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-4">
            <Rocket size={32} />
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">MOSH</h1>
          <p className="text-lg text-foreground/60 max-w-2xl mx-auto">
            Configure your node once and launch straight into a live MOSS session.
            This onboarding is the primary entry flow for the desktop app.
          </p>
          
          <div className="flex flex-wrap justify-center gap-6 pt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground/40">
              <Zap size={16} className="text-accent" />
              <span>Shared runtime</span>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-foreground/40">
              <Shield size={16} className="text-primary" />
              <span>Direct P2P</span>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-foreground/40">
              <Rocket size={16} className="text-accent" />
              <span>Tracker + LAN bootstrap</span>
            </div>
          </div>
        </header>

        <RuntimeSetupPanel
          nickname={nickname}
          meshId={meshId}
          listenPort={listenPort}
          initialRoom={initialRoom}
          startupPeer={startupPeer}
          trackerMode={trackerMode}
          lanDiscoveryEnabled={lanDiscoveryEnabled}
          configPreview={configPreview}
          errorNote={errorNote}
          isSaving={isSaving}
          primaryActionLabel={isSaving ? 'Applying and starting...' : 'Apply and start runtime'}
          secondaryActionLabel="Open shell without starting"
          onNicknameChange={onNicknameChange}
          onMeshIdChange={onMeshIdChange}
          onListenPortChange={onListenPortChange}
          onInitialRoomChange={onInitialRoomChange}
          onStartupPeerChange={onStartupPeerChange}
          onTrackerModeChange={onTrackerModeChange}
          onLanDiscoveryChange={onLanDiscoveryChange}
          onSave={onSave}
          onSecondaryAction={onSkip}
        />
      </div>
    </main>
  )
}

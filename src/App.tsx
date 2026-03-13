import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChatHeader } from './components/ChatHeader'
import { CreateChannelModal } from './components/CreateChannelModal'
import { DiagnosticsPanel } from './components/DiagnosticsPanel'
import { MessagePanel } from './components/MessagePanel'
import { OnboardingScreen } from './components/OnboardingScreen'
import { PeerPanel } from './components/PeerPanel'
import { ProfileEditorPanel } from './components/ProfileEditorPanel'
import { QuickActionsPanel } from './components/QuickActionsPanel'
import { RuntimePanel } from './components/RuntimePanel'
import { Sidebar } from './components/Sidebar'
import { useDesktopErrorDialogs } from './hooks/useDesktopErrorDialogs'
import { useDesktopNotifications } from './hooks/useDesktopNotifications'
import { desktopStatusClient } from './lib/desktopStatusClient'
import { getFallbackRoom } from './lib/fallbacks'
import { cn } from './lib/utils'

type ShellView = 'chat' | 'profile'

export function App() {
  const [selectedRoomId, setSelectedRoomId] = useState('lobby')
  const [selectedView, setSelectedView] = useState<ShellView>('chat')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [roomSearch, setRoomSearch] = useState('')
  const [nicknameDraft, setNicknameDraft] = useState<string | null>(null)
  const [meshDraft, setMeshDraft] = useState<string | null>(null)
  const [listenPortDraft, setListenPortDraft] = useState<string | null>(null)
  const [initialRoomDraft, setInitialRoomDraft] = useState<string | null>(null)
  const [startupPeerDraft, setStartupPeerDraft] = useState<string | null>(null)
  const [trackerModeDraft, setTrackerModeDraft] = useState<'default' | 'disabled' | null>(
    null,
  )
  const [lanDiscoveryDraft, setLanDiscoveryDraft] = useState<boolean | null>(null)
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null)
  const [avatarFileName, setAvatarFileName] = useState<string | null>(null)
  const [roomDraft, setRoomDraft] = useState('design-reviews')
  const [peerDraft, setPeerDraft] = useState('')
  const [directDraft, setDirectDraft] = useState('')
  const [messageDraft, setMessageDraft] = useState('')
  const queryClient = useQueryClient()

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreviewUrl)
      }
    }
  }, [avatarPreviewUrl])

  const snapshot = useQuery({
    queryKey: ['desktop-snapshot'],
    queryFn: () => desktopStatusClient.getSnapshot(),
    refetchInterval: 1500,
  })

  useDesktopNotifications({
    snapshot: snapshot.data,
    selectedRoomId,
  })

  const toggleRuntime = useMutation({
    mutationFn: () => desktopStatusClient.toggleRuntime(),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
    },
  })

  const updateRuntimeSettings = useMutation({
    mutationFn: () =>
      desktopStatusClient.updateRuntimeSettings({
        nickname: nicknameDraft ?? snapshot.data?.settings.nickname ?? 'operator',
        meshId: meshDraft ?? snapshot.data?.settings.meshId ?? 'mosh-chat',
        listenPort: Number(listenPortDraft ?? snapshot.data?.settings.listenPort ?? 0),
        initialRoom: initialRoomDraft ?? snapshot.data?.settings.initialRoom ?? 'lobby',
        startupPeer: startupPeerDraft ?? snapshot.data?.settings.startupPeer ?? '',
        trackerMode: trackerModeDraft ?? snapshot.data?.settings.trackerMode ?? 'default',
        lanDiscoveryEnabled:
          lanDiscoveryDraft ?? snapshot.data?.settings.lanDiscoveryEnabled ?? true,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
      setSelectedRoomId(data.settings.initialRoom)
    },
  })

  const subscribeRoom = useMutation({
    mutationFn: () => desktopStatusClient.subscribeRoom({ room: roomDraft }),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
      const normalizedRoom = roomDraft.replace(/^#/, '').toLowerCase()
      setSelectedRoomId(normalizedRoom)
      setCreateModalOpen(false)
      setSidebarOpen(false)
      setSelectedView('chat')
    },
  })

  const connectPeer = useMutation({
    mutationFn: () => desktopStatusClient.connectPeer({ addr: peerDraft }),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
      setPeerDraft('')
    },
  })

  const openDirectRoom = useMutation({
    mutationFn: (target?: string) =>
      desktopStatusClient.openDirectRoom({ target: target ?? directDraft }),
    onSuccess: (data, target) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
      const targetLabel = (target ?? directDraft).trim().toLowerCase()
      const directRoom =
        data.rooms.find((room) => room.label.toLowerCase() === `@${targetLabel}`) ??
        data.rooms.find((room) => room.kind === 'dm')
      if (directRoom) {
        setSelectedRoomId(directRoom.id)
      }
      setDirectDraft('')
      setSelectedView('chat')
    },
  })

  const publishMessage = useMutation({
    mutationFn: () =>
      desktopStatusClient.publishMessage({
        room: selectedRoomId,
        body: messageDraft,
      }),
    onSuccess: (updatedSnapshot) => {
      queryClient.setQueryData(['desktop-snapshot'], updatedSnapshot)
      setMessageDraft('')
    },
  })

  const settingsError = updateRuntimeSettings.error?.message
  const actionError =
    subscribeRoom.error?.message ??
    connectPeer.error?.message ??
    openDirectRoom.error?.message
  const sendError = publishMessage.error?.message
  const runtimeError = toggleRuntime.error?.message

  useDesktopErrorDialogs({
    errors: [settingsError, actionError, sendError, runtimeError].filter(
      (value): value is string => Boolean(value),
    ),
  })

  if (snapshot.isPending) {
    return (
      <main className="h-screen flex items-center justify-center bg-background text-foreground/40 font-medium">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          Loading desktop runtime snapshot...
        </div>
      </main>
    )
  }

  if (snapshot.isError) {
    return (
      <main className="h-screen flex items-center justify-center bg-background p-6">
        <section className="max-w-md w-full bg-muted/30 border border-border/20 rounded-3xl p-8 backdrop-blur-sm shadow-xl space-y-4">
          <p className="text-xs uppercase tracking-widest text-red-400 font-bold">Bootstrap error</p>
          <h1 className="text-2xl font-bold">Desktop shell did not start cleanly</h1>
          <p className="text-foreground/60">{snapshot.error.message}</p>
        </section>
      </main>
    )
  }

  const data = snapshot.data
  const settings = data.settings
  const rooms = data.rooms.length > 0 ? data.rooms : [getFallbackRoom()]
  const nicknameValue = nicknameDraft ?? settings.nickname
  const meshValue = meshDraft ?? settings.meshId
  const listenPortValue = listenPortDraft ?? `${settings.listenPort}`
  const initialRoomValue = initialRoomDraft ?? settings.initialRoom
  const startupPeerValue = startupPeerDraft ?? settings.startupPeer
  const trackerModeValue = trackerModeDraft ?? settings.trackerMode
  const lanDiscoveryValue = lanDiscoveryDraft ?? settings.lanDiscoveryEnabled

  const visibleRooms = (() => {
    const filtered = rooms
      .filter((room) => room.id !== '__moss_chat_control__')
      .sort((left, right) => {
        if (left.kind === 'system' && right.kind !== 'system') {
          return 1
        }
        if (left.kind !== 'system' && right.kind === 'system') {
          return -1
        }
        return left.label.localeCompare(right.label)
      })
    return filtered.length > 0 ? filtered : [getFallbackRoom()]
  })()

  const filteredRooms = (() => {
    const needle = roomSearch.trim().toLowerCase()
    if (!needle) {
      return visibleRooms
    }
    return visibleRooms.filter((room) => room.label.toLowerCase().includes(needle))
  })()

  const sidebarChannels = filteredRooms.filter((room) => room.kind !== 'system')
  const sidebarUtilityRooms = filteredRooms.filter((room) => room.kind === 'system')

  const activeRoom =
    visibleRooms.find((room) => room.id === selectedRoomId) ??
    visibleRooms.find((room) => room.id === settings.initialRoom) ??
    visibleRooms[0]

  const visibleMessages = data.messages.filter((message) => message.roomId === activeRoom.id)

  const visiblePeers = data.peers.filter((peer) =>
    activeRoom.kind === 'system'
      ? true
      : peer.rooms.includes(activeRoom.label) || peer.rooms.includes(`#${activeRoom.id}`),
  )

  async function applyAndStartRuntime() {
    const updatedSnapshot = await updateRuntimeSettings.mutateAsync()
    setSelectedRoomId(updatedSnapshot.settings.initialRoom)
    if (updatedSnapshot.runtime.state !== 'Runtime online') {
      const runningSnapshot = await toggleRuntime.mutateAsync()
      setSelectedRoomId(runningSnapshot.settings.initialRoom)
    }
    setOnboardingDismissed(true)
  }

  function handleAvatarChange(file: File | null) {
    if (avatarPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreviewUrl)
    }
    if (!file) {
      setAvatarPreviewUrl(null)
      setAvatarFileName(null)
      return
    }
    setAvatarPreviewUrl(URL.createObjectURL(file))
    setAvatarFileName(file.name)
  }

  const showOnboarding = data.runtime.state !== 'Runtime online' && !onboardingDismissed

  if (showOnboarding) {
    return (
      <OnboardingScreen
        nickname={nicknameValue}
        meshId={meshValue}
        listenPort={listenPortValue}
        initialRoom={initialRoomValue}
        startupPeer={startupPeerValue}
        trackerMode={trackerModeValue}
        lanDiscoveryEnabled={lanDiscoveryValue}
        configPreview={settings.configPreview}
        errorNote={settingsError ?? runtimeError}
        isSaving={updateRuntimeSettings.isPending || toggleRuntime.isPending}
        onNicknameChange={setNicknameDraft}
        onMeshIdChange={setMeshDraft}
        onListenPortChange={setListenPortDraft}
        onInitialRoomChange={setInitialRoomDraft}
        onStartupPeerChange={setStartupPeerDraft}
        onTrackerModeChange={setTrackerModeDraft}
        onLanDiscoveryChange={setLanDiscoveryDraft}
        onSave={() => void applyAndStartRuntime()}
        onSkip={() => setOnboardingDismissed(true)}
      />
    )
  }

  return (
    <main className="h-screen w-screen flex flex-col bg-background overflow-hidden text-foreground">
      <RuntimePanel
        state={data.runtime.state}
        summary={data.runtime.summary}
        route={data.runtime.route}
        natHint={data.runtime.natHint}
        sharedBridge={data.runtime.sharedBridge}
        isOnline={data.runtime.state === 'Runtime online'}
        errorNote={runtimeError}
        onToggle={() => toggleRuntime.mutate()}
        isBusy={toggleRuntime.isPending}
      />

      <section className="flex-1 flex min-h-0 relative">
        <div className={cn(
          "fixed inset-y-0 left-0 z-40 w-72 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <Sidebar
            channels={sidebarChannels}
            utilityRooms={sidebarUtilityRooms}
            selectedRoomId={activeRoom.id}
            roomSearch={roomSearch}
            onRoomSearchChange={setRoomSearch}
            onOpenCreateChannel={() => setCreateModalOpen(true)}
            onSelectRoom={(roomId) => {
              setSelectedRoomId(roomId)
              setSelectedView('chat')
              setSidebarOpen(false)
            }}
            onOpenProfile={() => {
              setSelectedView('profile')
              setSidebarOpen(false)
            }}
          />
        </div>

        {sidebarOpen && (
          <div 
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <section className="flex-1 flex flex-col min-w-0">
          <ChatHeader
            room={activeRoom}
            peers={visiblePeers}
            runtime={data.runtime}
            onToggleSidebar={() => setSidebarOpen((current) => !current)}
          />

          {selectedView === 'profile' ? (
            <div className="flex-1 overflow-y-auto p-6 lg:p-12">
              <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-12">
                <div className="flex-1">
                  <ProfileEditorPanel
                    nickname={nicknameValue}
                    avatarPreviewUrl={avatarPreviewUrl}
                    avatarFileName={avatarFileName}
                    meshId={meshValue}
                    initialRoom={initialRoomValue}
                    startupPeer={startupPeerValue}
                    listenPort={listenPortValue}
                    trackerMode={trackerModeValue}
                    lanDiscoveryEnabled={lanDiscoveryValue}
                    configPreview={settings.configPreview}
                    errorNote={settingsError}
                    isSaving={updateRuntimeSettings.isPending}
                    onAvatarChange={handleAvatarChange}
                    onNicknameChange={setNicknameDraft}
                    onMeshIdChange={setMeshDraft}
                    onInitialRoomChange={setInitialRoomDraft}
                    onStartupPeerChange={setStartupPeerDraft}
                    onListenPortChange={setListenPortDraft}
                    onTrackerModeChange={setTrackerModeDraft}
                    onLanDiscoveryChange={setLanDiscoveryDraft}
                    onSave={() => updateRuntimeSettings.mutate()}
                  />
                </div>

                <div className="w-full lg:w-80 space-y-6">
                  <QuickActionsPanel
                    peerDraft={peerDraft}
                    directDraft={directDraft}
                    busyAction={
                      connectPeer.isPending
                        ? 'connect'
                        : openDirectRoom.isPending
                          ? 'dm'
                          : undefined
                    }
                    errorNote={actionError}
                    onPeerDraftChange={setPeerDraft}
                    onDirectDraftChange={setDirectDraft}
                    onConnectPeer={() => connectPeer.mutate()}
                    onOpenDirectRoom={() => openDirectRoom.mutate(directDraft)}
                  />
                  <DiagnosticsPanel diagnostics={data.diagnostics} />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex min-h-0">
              <MessagePanel
                room={activeRoom}
                messages={visibleMessages}
                draft={messageDraft}
                onDraftChange={setMessageDraft}
                onSend={() => publishMessage.mutate()}
                isSending={publishMessage.isPending}
                errorNote={sendError}
              />
              <div className="hidden xl:block w-72 flex-shrink-0">
                <PeerPanel
                  peers={visiblePeers}
                  onOpenDirectRoom={(target) => {
                    setDirectDraft(target)
                    openDirectRoom.mutate(target)
                  }}
                />
              </div>
            </div>
          )}
        </section>
      </section>

      {createModalOpen && (
        <CreateChannelModal
          roomDraft={roomDraft}
          isCreating={subscribeRoom.isPending}
          errorNote={subscribeRoom.error?.message}
          onRoomDraftChange={setRoomDraft}
          onCreate={() => subscribeRoom.mutate()}
          onClose={() => setCreateModalOpen(false)}
        />
      )}
    </main>
  )
}

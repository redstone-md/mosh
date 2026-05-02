import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BootstrapErrorScreen, LoadingScreen } from './components/AppBootstrapState'
import { MainSurface } from './components/shell/MainSurface'
import { ShellI18nFrame } from './components/shell/ShellI18nFrame'
import { OnboardingSurface } from './components/shell/OnboardingSurface'
import { useDesktopErrorDialogs } from './hooks/useDesktopErrorDialogs'
import { useDesktopNotifications } from './hooks/useDesktopNotifications'
import { useIdentityTransferFlow } from './hooks/useIdentityTransferFlow'
import { useInviteFlow } from './hooks/useInviteFlow'
import { useMessageOutbox } from './hooks/useMessageOutbox'
import { useMediaSession } from './hooks/useMediaSession'
import { findSecretPeerForRoom, useSecretRoomMessages } from './hooks/useSecretRoomMessages'
import { useDocumentAppearance } from './hooks/useDocumentAppearance'
import { useMessageOverlayState } from './hooks/useMessageOverlayState'
import { usePeerTrustState } from './hooks/usePeerTrustState'
import { useRoomDraftState } from './hooks/useRoomDraftState'
import { useRoomActivityState } from './hooks/useRoomActivityState'
import { useShellPreferences } from './hooks/useShellPreferences'
import { useSignedChatArchive } from './hooks/useSignedChatArchive'
import { debugLogError, describeUnknownError } from './lib/debugLog'
import {
  findRoomById,
  getVisiblePeers,
  sameRuntimeDraft,
  selectRoomFallback,
  toRuntimeDraft,
} from './lib/appShellSelectors'
import { reconcileGroups, reconcileRoomTypes } from './lib/appShellStorage'
import { dedupeMessages, formatRoomTitle } from './lib/chatPresentation'
import { desktopStatusClient } from './lib/desktopStatusClient'
import { desktopStorageClient } from './lib/desktopStorageClient'
import { getFallbackRoom } from './lib/fallbacks'
import { detectSystemLanguage, getI18nCopy } from './lib/i18n'
import { resolvePinnedMessages, togglePinnedMessage } from './lib/messagePins'
import { hasEncryptionIdentity, signingIdentityPublicBundle } from './lib/cryptoIdentity'
import { isPeerTrustedForSecret } from './lib/peerTrust'
import { decryptSecretArchive, encryptSecretArchive } from './lib/secretArchive'
import { encryptSecretMessage, secretRoomName, serializeSecretEnvelope } from './lib/secretMessages'
import type { ChannelType, RoomGroup, StoredMessage, ThemeId } from './lib/appShellSchemas'
import type { PeerSummary, UpdateRuntimeSettingsInput } from './lib/schemas'
import { SecretPeerVerificationDialog } from './components/shell/SecretPeerVerificationDialog'

export function App() {
  const queryClient = useQueryClient()
  const settingsHydratedRef = useRef(false)
  const runtimeAutoStartRef = useRef(false)
  const shellPreferences = useShellPreferences()
  const {
    preferences,
    setPreferences,
    identityFingerprint,
    identity,
    regenerateIdentity,
    saveIdentityRollbackSnapshot,
    restoreIdentityRollbackSnapshot,
    recordIdentityTransferEvent,
    reload,
  } = shellPreferences
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [archiveRefreshKey, setArchiveRefreshKey] = useState(0)
  const [secretArchivePassphrase, setSecretArchivePassphrase] = useState('')
  const [secretArchiveMessages, setSecretArchiveMessages] = useState<StoredMessage[]>([])
  const [secretArchiveError, setSecretArchiveError] = useState<string | undefined>()
  const [pendingSecretPeer, setPendingSecretPeer] = useState<PeerSummary | null>(null)
  const systemLanguage = useMemo(() => detectSystemLanguage(), [])

  const snapshot = useQuery({
    queryKey: ['desktop-snapshot'],
    queryFn: () => desktopStatusClient.getSnapshot(),
    refetchInterval: 1500,
  })

  const toggleRuntime = useMutation({
    mutationFn: () => desktopStatusClient.toggleRuntime(),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
    },
  })

  const updateRuntimeSettings = useMutation({
    mutationFn: (draft: UpdateRuntimeSettingsInput) => desktopStatusClient.updateRuntimeSettings(draft),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
      setPreferences((current) => ({
        ...current,
        runtimeDraft: toRuntimeDraft(data.settings),
        selectedRoomId: data.settings.initialRoom,
      }))
    },
  })

  const subscribeRoom = useMutation({
    mutationFn: (room: string) => desktopStatusClient.subscribeRoom({ room }),
    onSuccess: (data, room) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
      setPreferences((current) => ({
        ...current,
        selectedDock: 'group',
        selectedRoomId: room.replace(/^#/, '').toLowerCase(),
      }))
    },
  })

  const openDirectRoom = useMutation({
    mutationFn: (target: string) => desktopStatusClient.openDirectRoom({ target }),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
      const nextRoom =
        data.rooms.find((room) => room.kind === 'dm' && room.id !== preferences.selectedRoomId) ??
        data.rooms.find((room) => room.kind === 'dm')
      if (nextRoom) {
        setPreferences((current) => ({
          ...current,
          selectedDock: 'home',
          selectedRoomId: nextRoom.id,
        }))
      }
    },
  })

  const openSecretRoom = useMutation({
    mutationFn: (target: string) => desktopStatusClient.openSecretRoom({ target }),
    onSuccess: (data, target) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
      const selfPeerId = data.peers.find((peer) => peer.status === 'self')?.id ?? localPeerId
      const nextRoomId = selfPeerId ? secretRoomName(selfPeerId, target) : ''
      const nextRoom =
        data.rooms.find((room) => room.id === nextRoomId) ?? data.rooms.find((room) => room.kind === 'secret-dm')
      if (nextRoom) {
        setPreferences((current) => ({
          ...current,
          selectedDock: 'home',
          selectedRoomId: nextRoom.id,
        }))
      }
    },
  })

  const publishMessage = useMutation({
    mutationFn: ({ roomId, body }: { roomId: string; body: string }) =>
      desktopStatusClient.publishMessage({
        room: roomId,
        body,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
    },
  })

  const publishSecretMessage = useMutation({
    mutationFn: ({ roomId, payloadJson }: { roomId: string; payloadJson: string }) =>
      desktopStatusClient.publishSecretMessage({
        room: roomId,
        payloadJson,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
    },
  })

  const connectPeer = useMutation({
    mutationFn: (addr: string) => desktopStatusClient.connectPeer({ addr }),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
    },
  })

  const mediaSession = useMediaSession(snapshot.data)
  const activeLanguage = useDocumentAppearance(preferences.theme, preferences.languagePreference, systemLanguage)
  const activeCopy = getI18nCopy(activeLanguage)

  useEffect(() => {
    if (shellPreferences.isPending || !snapshot.data || settingsHydratedRef.current) {
      return
    }
    settingsHydratedRef.current = true

    if (!sameRuntimeDraft(snapshot.data.settings, preferences.runtimeDraft)) {
      void updateRuntimeSettings.mutateAsync(preferences.runtimeDraft).catch(() => {
        settingsHydratedRef.current = false
      })
    }
  }, [preferences.runtimeDraft, shellPreferences.isPending, snapshot.data, updateRuntimeSettings])

  useEffect(() => {
    if (!snapshot.data || !preferences.onboardingCompleted) {
      return
    }
    if (!settingsHydratedRef.current || runtimeAutoStartRef.current) {
      return
    }
    if (snapshot.data.runtime.state !== 'Runtime offline') {
      return
    }

    runtimeAutoStartRef.current = true
    void toggleRuntime.mutateAsync().catch(() => undefined)
  }, [preferences.onboardingCompleted, snapshot.data, toggleRuntime])

  useDesktopNotifications({
    snapshot: snapshot.data,
    selectedRoomId: preferences.selectedRoomId,
    mutedRoomIds: preferences.mutedRooms,
    language: activeLanguage,
  })

  useDesktopErrorDialogs({
    errors: [
      snapshot.error instanceof Error ? snapshot.error.message : undefined,
      shellPreferences.error instanceof Error ? shellPreferences.error.message : undefined,
      toggleRuntime.error?.message,
      updateRuntimeSettings.error?.message,
      subscribeRoom.error?.message,
      openDirectRoom.error?.message,
      openSecretRoom.error?.message,
      publishMessage.error?.message,
      publishSecretMessage.error?.message,
      connectPeer.error?.message,
      mediaSession.state.error ?? undefined,
    ].filter((value): value is string => Boolean(value)),
  })

  const data = snapshot.data
  const runtimeDraft = preferences.runtimeDraft
  const showOnboarding = data?.runtime.state !== 'Runtime online' && !preferences.onboardingCompleted
  const mentionablePeerNames = useMemo(
    () => (data?.peers ?? []).filter((peer) => peer.status !== 'self').map((peer) => peer.displayName),
    [data?.peers]
  )
  const visibleRooms = useMemo(() => (data?.rooms.length ? data.rooms : [getFallbackRoom()]), [data?.rooms])
  const reconciledGroups = useMemo(
    () => reconcileGroups(preferences.groups, visibleRooms),
    [preferences.groups, visibleRooms]
  )
  const reconciledRoomTypes = useMemo(
    () => reconcileRoomTypes(preferences.roomTypes, visibleRooms),
    [preferences.roomTypes, visibleRooms]
  )
  const activeRoom = useMemo(
    () =>
      data
        ? (selectRoomFallback(
            visibleRooms,
            preferences.selectedDock,
            reconciledGroups,
            preferences.selectedGroupId,
            preferences.selectedRoomId,
            data.settings.initialRoom
          ) ?? getFallbackRoom())
        : getFallbackRoom(),
    [
      data,
      preferences.selectedDock,
      preferences.selectedGroupId,
      preferences.selectedRoomId,
      reconciledGroups,
      visibleRooms,
    ]
  )
  const visiblePeers = useMemo(() => (data ? getVisiblePeers(activeRoom, data.peers) : []), [activeRoom, data])
  const localPeerId = useMemo(() => data?.peers.find((peer) => peer.status === 'self')?.id ?? '', [data?.peers])
  const peersById = useMemo(() => new Map((data?.peers ?? []).map((peer) => [peer.id, peer] as const)), [data?.peers])
  const secretPeerId = useMemo(
    () =>
      data && localPeerId
        ? findSecretPeerForRoom(
            activeRoom.id,
            localPeerId,
            data.peers.filter((peer) => peer.status !== 'self').map((peer) => peer.id)
          )
        : null,
    [activeRoom.id, data, localPeerId]
  )
  const activeRoomIsSecret = activeRoom.kind === 'secret-dm'
  const liveMessages = useMemo(
    () => (data ? dedupeMessages(data.messages.filter((message) => message.roomId === activeRoom.id)) : []),
    [activeRoom.id, data?.messages]
  )
  const archiveState = useSignedChatArchive(
    showOnboarding || activeRoomIsSecret ? '__inactive__' : activeRoom.id,
    showOnboarding || activeRoomIsSecret ? [] : liveMessages,
    archiveRefreshKey
  )
  const activePinnedMessageIds = preferences.pinnedMessages[activeRoom.id] ?? []
  const roomActivity = useRoomActivityState({
    snapshot: data,
    selectedRoomId: preferences.selectedRoomId,
    lastReadMessageIds: preferences.lastReadMessageIds,
    mutedRooms: preferences.mutedRooms,
    setPreferences,
  })
  const peerTrust = usePeerTrustState({
    peers: data?.peers ?? [],
    trustedPeers: preferences.trustedPeers,
    setPreferences,
  })
  const roomDraftState = useRoomDraftState({
    roomDrafts: preferences.roomDrafts,
    setPreferences,
  })
  const messageOverlayState = useMessageOverlayState({
    messageOverlays: preferences.messageOverlays,
    setPreferences,
    hiddenLabel: activeCopy.messages.hiddenLocally,
  })
  const overlaidMessages = useMemo(
    () => messageOverlayState.applyOverlays(archiveState.mergedMessages),
    [archiveState.mergedMessages, messageOverlayState.applyOverlays]
  )
  const secretMessages = useSecretRoomMessages({
    roomId: activeRoom.id,
    events: data?.secretMessages ?? [],
    peersById,
    trustedPeers: preferences.trustedPeers,
    localPeerId,
    localDisplayName: runtimeDraft.nickname,
    identity,
    archiveMessages: secretArchiveMessages,
    unlocked: Boolean(secretArchivePassphrase.trim()),
    decryptErrorMessage: activeCopy.messages.secretDecryptFailed,
  })
  const pinnedMessages = useMemo(
    () => resolvePinnedMessages(preferences.pinnedMessages, activeRoom.id, overlaidMessages),
    [activeRoom.id, overlaidMessages, preferences.pinnedMessages]
  )
  const messageOutbox = useMessageOutbox({
    currentUser: runtimeDraft.nickname,
    liveMessages: data?.messages ?? [],
    publishMessage: async (roomId, body) => {
      await publishMessage.mutateAsync({ roomId, body })
    },
  })
  const displayMessages = useMemo(
    () =>
      activeRoomIsSecret
        ? secretMessages
        : messageOutbox.buildDisplayMessages(
            activeRoom.id,
            overlaidMessages,
            archiveState.archive?.messages.map((message) => message.id) ?? []
          ),
    [
      activeRoom.id,
      activeRoomIsSecret,
      archiveState.archive?.messages,
      overlaidMessages,
      messageOutbox.buildDisplayMessages,
      secretMessages,
    ]
  )
  const messageDraft = roomDraftState.getDraft(activeRoom.id)
  useEffect(() => {
    if (JSON.stringify(reconciledGroups) === JSON.stringify(preferences.groups)) {
      return
    }
    setPreferences((current) => ({
      ...current,
      groups: reconciledGroups,
    }))
  }, [preferences.groups, reconciledGroups])

  useEffect(() => {
    if (JSON.stringify(reconciledRoomTypes) === JSON.stringify(preferences.roomTypes)) {
      return
    }
    setPreferences((current) => ({
      ...current,
      roomTypes: reconciledRoomTypes,
    }))
  }, [preferences.roomTypes, reconciledRoomTypes])

  useEffect(() => {
    const publicBundle = identity ? signingIdentityPublicBundle(identity) : null
    if (!data || data.runtime.state !== 'Runtime online' || !publicBundle) {
      return
    }
    void desktopStatusClient.setIdentityPresence(publicBundle).catch((error) => {
      void debugLogError(`Identity presence update failed: ${describeUnknownError(error)}`)
    })
  }, [data?.runtime.state, identity])

  useEffect(() => {
    let cancelled = false
    async function loadSecretArchive() {
      setSecretArchiveError(undefined)
      setSecretArchiveMessages([])
      if (!activeRoomIsSecret || !secretArchivePassphrase.trim()) {
        return
      }
      try {
        const archive = await desktopStorageClient.loadSecretArchive(activeRoom.id)
        if (!archive || cancelled) {
          return
        }
        const messages = await decryptSecretArchive(archive, secretArchivePassphrase)
        if (!cancelled) {
          setSecretArchiveMessages(messages)
        }
      } catch (error) {
        if (!cancelled) {
          setSecretArchiveError(describeUnknownError(error))
        }
      }
    }

    void loadSecretArchive()
    return () => {
      cancelled = true
    }
  }, [activeRoom.id, activeRoomIsSecret, secretArchivePassphrase])

  useEffect(() => {
    if (!activeRoomIsSecret || !secretArchivePassphrase.trim() || secretMessages.length === 0) {
      return
    }
    const storedMessages = secretMessages.map((message) => ({
      ...message,
      storedAt: 'storedAt' in message ? String(message.storedAt) : new Date().toISOString(),
    }))
    const timeout = window.setTimeout(() => {
      void encryptSecretArchive(activeRoom.id, storedMessages, secretArchivePassphrase)
        .then((archive) => desktopStorageClient.saveSecretArchive(activeRoom.id, archive))
        .catch((error) => setSecretArchiveError(describeUnknownError(error)))
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [activeRoom.id, activeRoomIsSecret, secretArchivePassphrase, secretMessages])
  const inviteFlow = useInviteFlow({
    copy: {
      inviteApplied: activeCopy.createSpace.inviteApplied,
      inviteInvalid: activeCopy.createSpace.inviteInvalid,
    },
    data,
    runtimeDraft: preferences.runtimeDraft,
    currentIdentityFingerprint: identityFingerprint,
    regenerateIdentity,
    setPreferences,
    updateRuntimeSettings,
    connectPeer,
    subscribeRoom,
  })
  const identityTransferFlow = useIdentityTransferFlow({
    copy: {
      invalidLink: activeCopy.identityTransfer.deepLinkInvalid,
      imported: activeCopy.identityTransfer.deepLinkImported,
      importFailed: activeCopy.identityTransfer.importFailed,
    },
    currentIdentityFingerprint: identityFingerprint,
    onImported: reload,
    onRecordEvent: recordIdentityTransferEvent,
    onSaveRollbackSnapshot: saveIdentityRollbackSnapshot,
  })
  const shellFrameProps = {
    language: activeLanguage,
    systemLanguage,
    languagePreference: preferences.languagePreference,
    onLanguagePreferenceChange: handleLanguagePreferenceChange,
    invite: {
      pendingInvite: inviteFlow.pendingInvite,
      isBusy: inviteFlow.reviewPending,
      currentIdentityFingerprint: inviteFlow.currentIdentityFingerprint,
      identityMode: inviteFlow.identityMode,
      onIdentityModeChange: inviteFlow.setIdentityMode,
      onApprove: () => void inviteFlow.approvePendingInvite(),
      onDismiss: inviteFlow.dismissPendingInvite,
    },
    identityTransfer: {
      pendingTransfer: identityTransferFlow.pendingTransfer,
      currentIdentityFingerprint: identityTransferFlow.currentIdentityFingerprint,
      passphrase: identityTransferFlow.passphrase,
      errorNote: identityTransferFlow.errorNote,
      isBusy: identityTransferFlow.importPending,
      onPassphraseChange: identityTransferFlow.setPassphrase,
      onApprove: () => void identityTransferFlow.approvePendingTransfer(),
      onDismiss: identityTransferFlow.dismissPendingTransfer,
    },
  }

  if (shellPreferences.isPending || snapshot.isPending)
    return (
      <ShellI18nFrame {...shellFrameProps}>
        <LoadingScreen />
      </ShellI18nFrame>
    )
  if (shellPreferences.error instanceof Error || snapshot.isError)
    return (
      <ShellI18nFrame {...shellFrameProps}>
        <BootstrapErrorScreen
          message={
            shellPreferences.error instanceof Error
              ? shellPreferences.error.message
              : (snapshot.error?.message ?? activeCopy.app.bootstrapError)
          }
        />
      </ShellI18nFrame>
    )

  if (!data) return null

  async function handleStartFromOnboarding() {
    const updated = await updateRuntimeSettings.mutateAsync(preferences.runtimeDraft)
    setPreferences((current) => ({
      ...current,
      onboardingCompleted: true,
      selectedRoomId: updated.settings.initialRoom,
    }))
    if (updated.runtime.state !== 'Runtime online') {
      runtimeAutoStartRef.current = true
      void toggleRuntime.mutateAsync().catch(() => undefined)
    }
  }

  function handleSkipOnboarding() {
    setPreferences((current) => ({ ...current, onboardingCompleted: true }))
  }
  async function handleSaveRuntime() {
    await updateRuntimeSettings.mutateAsync(preferences.runtimeDraft)
  }

  function handleCreateGroup(group: Omit<RoomGroup, 'id'>) {
    const nextId = `group-${Date.now().toString(36)}`
    setPreferences((current) => ({
      ...current,
      selectedDock: 'group',
      selectedGroupId: nextId,
      groups: [...current.groups, { id: nextId, ...group }],
    }))
  }

  async function handleSendMessage() {
    if (!activeRoom || messageDraft.trim().length === 0) return
    const nextDraft = messageDraft.trim()
    roomDraftState.clearDraft(activeRoom.id)
    try {
      if (activeRoom.kind === 'secret-dm') {
        if (!data) {
          throw new Error(activeCopy.messages.desktopSnapshotNotReady)
        }
        if (!identity || !hasEncryptionIdentity(identity)) {
          throw new Error(activeCopy.messages.localE2eeNotReady)
        }
        if (!secretArchivePassphrase.trim()) {
          throw new Error(activeCopy.messages.secretArchiveUnlockRequired)
        }
        const targetPeerId = secretPeerId
        const trustedPeer = targetPeerId ? preferences.trustedPeers[targetPeerId] : null
        if (!targetPeerId || !trustedPeer) {
          throw new Error(activeCopy.messages.secretRecipientUntrusted)
        }
        const envelope = await encryptSecretMessage({
          meshId: data.settings.meshId,
          roomId: activeRoom.id,
          senderPeerId: localPeerId,
          recipientPeerId: targetPeerId,
          body: nextDraft,
          senderIdentity: identity,
          recipient: trustedPeer,
        })
        await publishSecretMessage.mutateAsync({
          roomId: activeRoom.id,
          payloadJson: serializeSecretEnvelope(envelope),
        })
        return
      }
      await messageOutbox.sendMessage(activeRoom.id, nextDraft)
    } catch (error) {
      if (activeRoom.kind === 'secret-dm') {
        setSecretArchiveError(describeUnknownError(error))
      }
      void debugLogError(`Message send failed: ${describeUnknownError(error)}`)
    }
  }

  function handleOpenSecretRoom(peer: PeerSummary) {
    if (!peer.secureFingerprint || !peer.signingPublicKeyJwk || !peer.encryptionPublicKeyJwk) {
      setSecretArchiveError(activeCopy.messages.secretChatUnavailable(peer.displayName))
      return
    }
    if (!isPeerTrustedForSecret(preferences.trustedPeers, peer)) {
      setPendingSecretPeer(peer)
      return
    }
    openSecretRoom.mutate(peer.id)
  }

  function handleApproveSecretPeer(peer: PeerSummary) {
    setPreferences((current) => ({
      ...current,
      trustedPeers: {
        ...current.trustedPeers,
        [peer.id]: {
          displayName: peer.displayName,
          approvedAt: new Date().toISOString(),
          secureFingerprint: peer.secureFingerprint ?? undefined,
          signingPublicKeyJwk: peer.signingPublicKeyJwk ?? undefined,
          encryptionPublicKeyJwk: peer.encryptionPublicKeyJwk ?? undefined,
        },
      },
    }))
    setPendingSecretPeer(null)
    openSecretRoom.mutate(peer.id)
  }

  async function handleRetryMessage(clientId: string) {
    try {
      await messageOutbox.retryMessage(clientId)
    } catch (error) {
      void debugLogError(`Message retry failed: ${describeUnknownError(error)}`)
    }
  }

  function handleThemeChange(theme: ThemeId) {
    setPreferences((current) => ({ ...current, theme }))
  }

  function handleLanguagePreferenceChange(languagePreference: 'system' | 'en' | 'ru') {
    setPreferences((current) => ({ ...current, languagePreference }))
  }

  function handleRuntimeDraftChange(draft: UpdateRuntimeSettingsInput) {
    setPreferences((current) => ({ ...current, runtimeDraft: draft }))
  }

  function handleSaveWorkspace(groups: RoomGroup[], roomTypes: Record<string, ChannelType>, selectedGroupId: string) {
    const nextGroups = reconcileGroups(groups, visibleRooms)
    const nextRoomTypes = reconcileRoomTypes(roomTypes, visibleRooms)
    const nextSelectedGroupId =
      nextGroups.find((group) => group.id === selectedGroupId)?.id ?? nextGroups[0]?.id ?? 'mesh'

    setPreferences((current) => ({
      ...current,
      groups: nextGroups,
      roomTypes: nextRoomTypes,
      selectedGroupId: nextSelectedGroupId,
    }))
  }

  async function handleRestoreStorage() {
    settingsHydratedRef.current = false
    runtimeAutoStartRef.current = false
    await shellPreferences.reload()
    await queryClient.invalidateQueries({ queryKey: ['desktop-snapshot'] })
    setArchiveRefreshKey((current) => current + 1)
  }

  async function handleRestoreRollbackSnapshot(snapshotId: string) {
    const selectedSnapshot = preferences.identityRollbackSnapshots.find((snapshot) => snapshot.id === snapshotId)
    if (!selectedSnapshot) throw new Error('Rollback snapshot not found.')
    const previousFingerprint = identityFingerprint
    const restoredSnapshot = await restoreIdentityRollbackSnapshot(snapshotId)
    recordIdentityTransferEvent({
      action: 'rollback',
      channel: 'manual',
      activeFingerprint: restoredSnapshot.fingerprint,
      replacedFingerprint: previousFingerprint,
      packageSourceFingerprint: restoredSnapshot.fingerprint,
      packageExportedAt: restoredSnapshot.capturedAt,
    })
  }

  const mediaLabel = mediaSession.state.activeRoomId
    ? activeCopy.runtime.roomLiveLabel(
        formatRoomTitle(
          visibleRooms.find((room) => room.id === mediaSession.state.activeRoomId),
          activeCopy.common.unknownRoom
        ),
        mediaSession.state.remoteStreams.length
      )
    : activeCopy.runtime.offlineLabel
  const activeVoiceRoom = data.voiceRooms.find((room) => room.joined) ?? null

  if (showOnboarding) {
    return (
      <ShellI18nFrame {...shellFrameProps}>
        <OnboardingSurface
          runtime={data.runtime}
          theme={preferences.theme}
          languagePreference={preferences.languagePreference}
          playIntro={!shellPreferences.hasPersistedPreferences}
          runtimeDraft={runtimeDraft}
          isBusy={toggleRuntime.isPending || updateRuntimeSettings.isPending}
          formErrorNote={toggleRuntime.error?.message ?? updateRuntimeSettings.error?.message}
          titlebarErrorNote={toggleRuntime.error?.message}
          onThemeChange={handleThemeChange}
          onLanguagePreferenceChange={handleLanguagePreferenceChange}
          onRuntimeDraftChange={handleRuntimeDraftChange}
          onStart={() => void handleStartFromOnboarding()}
          onSkip={handleSkipOnboarding}
          onToggleRuntime={() => toggleRuntime.mutate()}
          runtimeToggleBusy={toggleRuntime.isPending}
        />
      </ShellI18nFrame>
    )
  }

  return (
    <ShellI18nFrame {...shellFrameProps}>
      <MainSurface
        data={data}
        runtimeDraft={runtimeDraft}
        preferences={{
          theme: preferences.theme,
          languagePreference: preferences.languagePreference,
          selectedDock: preferences.selectedDock,
          selectedGroupId: preferences.selectedGroupId,
          selectedRoomId: preferences.selectedRoomId,
        }}
        reconciledGroups={reconciledGroups}
        visibleRooms={visibleRooms}
        activeRoom={activeRoom}
        visiblePeers={visiblePeers}
        currentUser={runtimeDraft.nickname}
        mentionablePeerNames={mentionablePeerNames}
        createDialogOpen={createDialogOpen}
        settingsOpen={settingsOpen}
        draftPreviews={roomDraftState.draftPreviews}
        archiveState={archiveState}
        displayMessages={displayMessages}
        archiveRefreshToken={archiveRefreshKey}
        identityFingerprint={identityFingerprint}
        mediaLabel={mediaLabel}
        activeVoiceRoom={activeVoiceRoom}
        mediaSession={mediaSession}
        messageDraft={messageDraft}
        roomTypes={reconciledRoomTypes}
        unreadCounts={roomActivity.unreadCounts}
        mutedRoomIds={roomActivity.mutedRooms}
        trustByPeerId={peerTrust.trustByPeerId}
        trustedPeerEntries={peerTrust.trustedPeerEntries}
        trustedCount={peerTrust.trustedCount}
        reviewCount={peerTrust.reviewCount}
        identityTransferHistory={preferences.identityTransferHistory}
        identityRollbackSnapshots={preferences.identityRollbackSnapshots}
        pinnedMessages={pinnedMessages}
        pinnedMessageIds={activePinnedMessageIds}
        publishPending={activeRoomIsSecret ? publishSecretMessage.isPending : publishMessage.isPending}
        publishError={
          activeRoomIsSecret
            ? (publishSecretMessage.error?.message ?? secretArchiveError)
            : publishMessage.error?.message
        }
        secretArchiveLocked={activeRoomIsSecret && !secretArchivePassphrase.trim()}
        secretArchivePassphrase={secretArchivePassphrase}
        runtimeTogglePending={toggleRuntime.isPending}
        runtimeToggleError={toggleRuntime.error?.message}
        runtimeSettingsPending={updateRuntimeSettings.isPending}
        runtimeSettingsError={updateRuntimeSettings.error?.message}
        onToggleRuntime={() => toggleRuntime.mutate()}
        onSelectHome={() =>
          setPreferences((current) => ({
            ...current,
            selectedDock: 'home',
            selectedRoomId: ['dm', 'secret-dm'].includes(findRoomById(visibleRooms, current.selectedRoomId)?.kind ?? '')
              ? current.selectedRoomId
              : (visibleRooms.find((room) => ['dm', 'secret-dm'].includes(room.kind))?.id ?? current.selectedRoomId),
          }))
        }
        onSelectGroup={(groupId) =>
          setPreferences((current) => ({
            ...current,
            selectedDock: 'group',
            selectedGroupId: groupId,
          }))
        }
        onOpenCreate={() => setCreateDialogOpen(true)}
        onCloseCreate={setCreateDialogOpen}
        onOpenSettings={setSettingsOpen}
        onSelectRoom={(roomId) =>
          setPreferences((current) => ({
            ...current,
            selectedRoomId: roomId,
            selectedDock: ['dm', 'secret-dm'].includes(findRoomById(visibleRooms, roomId)?.kind ?? '')
              ? 'home'
              : current.selectedDock,
          }))
        }
        onOpenDirectRoom={(target) => openDirectRoom.mutate(target)}
        onOpenSecretRoom={handleOpenSecretRoom}
        onCreateChannel={(room, channelType) => {
          setPreferences((current) => ({
            ...current,
            roomTypes: {
              ...current.roomTypes,
              [room.replace(/^#/, '').toLowerCase()]: channelType,
            },
          }))
          subscribeRoom.mutate(room)
        }}
        onCreateGroup={handleCreateGroup}
        onApplyInvite={inviteFlow.applyInvite}
        onDraftChange={(value) => roomDraftState.setDraft(activeRoom.id, value)}
        onUnlockSecretArchive={setSecretArchivePassphrase}
        onSendMessage={() => void handleSendMessage()}
        onRetryMessage={(clientId) => void handleRetryMessage(clientId)}
        onDismissMessage={messageOutbox.dismissMessage}
        onEditMessage={messageOverlayState.editMessage}
        onToggleMessageHidden={messageOverlayState.toggleMessageHidden}
        onTogglePinMessage={(messageId) =>
          setPreferences((current) => ({
            ...current,
            pinnedMessages: togglePinnedMessage(current.pinnedMessages, activeRoom.id, messageId),
          }))
        }
        onToggleMuteRoom={roomActivity.toggleRoomMute}
        onTogglePeerTrust={peerTrust.togglePeerTrust}
        onForgetPeer={peerTrust.removeTrustedPeer}
        onRecordTransferEvent={recordIdentityTransferEvent}
        onSaveRollbackSnapshot={saveIdentityRollbackSnapshot}
        onRestoreRollbackSnapshot={handleRestoreRollbackSnapshot}
        onThemeChange={handleThemeChange}
        onLanguagePreferenceChange={handleLanguagePreferenceChange}
        onRuntimeDraftChange={handleRuntimeDraftChange}
        onSaveRuntime={() => void handleSaveRuntime()}
        onSaveWorkspace={handleSaveWorkspace}
        onRestoreStorage={() => void handleRestoreStorage()}
        onResetOnboarding={() =>
          setPreferences((current) => ({
            ...current,
            onboardingCompleted: false,
          }))
        }
      />
      <SecretPeerVerificationDialog
        peer={pendingSecretPeer}
        onApprove={handleApproveSecretPeer}
        onDismiss={() => setPendingSecretPeer(null)}
      />
    </ShellI18nFrame>
  )
}

import type { ChannelType, LanguagePreference, RoomGroup, ThemeId } from '../../lib/appShellSchemas'
import { describeArchiveStateLabel } from '../../lib/i18n'
import { formatRoomTitle } from '../../lib/chatPresentation'
import type { MediaSessionState } from '../../hooks/useMediaSession'
import type { VerifiedArchive } from '../../lib/appShellStorage'
import type { DesktopSnapshot, PeerSummary, RoomSummary, VoiceRoom, UpdateRuntimeSettingsInput } from '../../lib/schemas'
import { useI18n } from '../I18nProvider'
import { Titlebar } from '../Titlebar'
import { ShellToaster } from '../ShellToaster'
import { CallDock } from './CallDock'
import { ConversationSidebar } from './ConversationSidebar'
import { ConversationView } from './ConversationView'
import { CreateSpaceDialog } from './CreateSpaceDialog'
import { MemberSidebar } from './MemberSidebar'
import { ServerRail } from './ServerRail'
import { SettingsDialog } from './SettingsDialog'
import { getChannelType } from '../../lib/appShellStorage'

type MediaSessionController = {
  state: MediaSessionState
  joinVoiceRoom: (roomId: string, withScreenShare: boolean) => Promise<void>
  leaveVoiceRoom: () => Promise<void>
  toggleMicrophone: () => void
  startScreenShare: () => Promise<void>
  stopScreenShare: () => Promise<void>
}

type MainSurfaceProps = {
  data: DesktopSnapshot
  runtimeDraft: UpdateRuntimeSettingsInput
  preferences: {
    theme: ThemeId
    languagePreference: LanguagePreference
    selectedDock: 'home' | 'group'
    selectedGroupId: string
    selectedRoomId: string
  }
  reconciledGroups: RoomGroup[]
  visibleRooms: RoomSummary[]
  activeRoom: RoomSummary
  visiblePeers: PeerSummary[]
  mentionablePeerNames: string[]
  createDialogOpen: boolean
  settingsOpen: boolean
  archiveState: {
    archive: VerifiedArchive | null
    mergedMessages: DesktopSnapshot['messages']
  }
  identityFingerprint: string
  mediaLabel: string
  activeVoiceRoom: VoiceRoom | null
  mediaSession: MediaSessionController
  messageDraft: string
  roomTypes: Record<string, ChannelType>
  publishPending: boolean
  publishError?: string
  runtimeTogglePending: boolean
  runtimeToggleError?: string
  runtimeSettingsPending: boolean
  runtimeSettingsError?: string
  onToggleRuntime: () => void
  onSelectHome: () => void
  onSelectGroup: (groupId: string) => void
  onOpenCreate: () => void
  onCloseCreate: (open: boolean) => void
  onOpenSettings: (open: boolean) => void
  onSelectRoom: (roomId: string) => void
  onOpenDirectRoom: (target: string) => void
  onCreateChannel: (room: string, channelType: ChannelType) => void
  onCreateGroup: (group: Omit<RoomGroup, 'id'>) => void
  onDraftChange: (value: string) => void
  onSendMessage: () => void
  onThemeChange: (theme: ThemeId) => void
  onLanguagePreferenceChange: (value: 'system' | 'en' | 'ru') => void
  onRuntimeDraftChange: (draft: UpdateRuntimeSettingsInput) => void
  onSaveRuntime: () => void
  onSaveWorkspace: (
    groups: RoomGroup[],
    roomTypes: Record<string, ChannelType>,
    selectedGroupId: string,
  ) => void
  onRestoreStorage: () => void
  onResetOnboarding: () => void
}

export function MainSurface({
  data,
  runtimeDraft,
  preferences,
  reconciledGroups,
  visibleRooms,
  activeRoom,
  visiblePeers,
  mentionablePeerNames,
  createDialogOpen,
  settingsOpen,
  archiveState,
  identityFingerprint,
  mediaLabel,
  activeVoiceRoom,
  mediaSession,
  messageDraft,
  roomTypes,
  publishPending,
  publishError,
  runtimeTogglePending,
  runtimeToggleError,
  runtimeSettingsPending,
  runtimeSettingsError,
  onToggleRuntime,
  onSelectHome,
  onSelectGroup,
  onOpenCreate,
  onCloseCreate,
  onOpenSettings,
  onSelectRoom,
  onOpenDirectRoom,
  onCreateChannel,
  onCreateGroup,
  onDraftChange,
  onSendMessage,
  onThemeChange,
  onLanguagePreferenceChange,
  onRuntimeDraftChange,
  onSaveRuntime,
  onSaveWorkspace,
  onRestoreStorage,
  onResetOnboarding,
}: MainSurfaceProps) {
  const { copy } = useI18n()
  const archiveLabel = describeArchiveStateLabel(
    copy,
    archiveState.archive?.signerFingerprint ?? identityFingerprint,
    archiveState.archive?.verified,
  )

  return (
    <main className="flex h-screen flex-col bg-[var(--app)] text-foreground">
      <ShellToaster />
      <Titlebar
        runtime={data.runtime}
        onToggleRuntime={onToggleRuntime}
        isBusy={runtimeTogglePending}
        errorNote={runtimeToggleError}
      />
      <section className="flex min-h-0 flex-1">
        <ServerRail
          groups={reconciledGroups}
          selectedDock={preferences.selectedDock}
          selectedGroupId={preferences.selectedGroupId}
          onSelectHome={onSelectHome}
          onSelectGroup={onSelectGroup}
          onOpenCreate={onOpenCreate}
        />
        <ConversationSidebar
          runtime={data.runtime}
          currentUser={runtimeDraft.nickname}
          selectedDock={preferences.selectedDock}
          activeGroup={reconciledGroups.find((group) => group.id === preferences.selectedGroupId)}
          rooms={visibleRooms}
          peers={data.peers}
          selectedRoomId={activeRoom.id}
          mediaLabel={mediaLabel}
          roomTypes={roomTypes}
          activeVoiceRoom={activeVoiceRoom}
          onSelectRoom={onSelectRoom}
          onOpenSettings={() => onOpenSettings(true)}
          onOpenCreate={onOpenCreate}
          onOpenDirectRoom={onOpenDirectRoom}
        />
        <ConversationView
          room={activeRoom}
          peers={visiblePeers}
          messages={archiveState.mergedMessages}
          archiveFingerprint={archiveState.archive?.signerFingerprint}
          archiveVerified={archiveState.archive?.verified}
          draft={messageDraft}
          isSending={publishPending}
          mediaLive={mediaSession.state.status === 'live'}
          mediaRoomId={mediaSession.state.activeRoomId}
          channelType={getChannelType(activeRoom, roomTypes)}
          peerNames={mentionablePeerNames}
          errorNote={publishError}
          onDraftChange={onDraftChange}
          onSend={onSendMessage}
          onOpenSettings={() => onOpenSettings(true)}
          onStartVoice={() => {
            if (mediaSession.state.activeRoomId === activeRoom.id) {
              void mediaSession.leaveVoiceRoom()
              return
            }
            void mediaSession.joinVoiceRoom(activeRoom.id, false)
          }}
          onStartScreenShare={() => {
            if (mediaSession.state.activeRoomId === activeRoom.id) {
              if (mediaSession.state.screenSharingEnabled) {
                void mediaSession.stopScreenShare()
              } else {
                void mediaSession.startScreenShare()
              }
              return
            }
            void mediaSession.joinVoiceRoom(activeRoom.id, true)
          }}
        />
        <MemberSidebar
          room={activeRoom}
          peers={visiblePeers}
          archiveFingerprint={archiveState.archive?.signerFingerprint ?? identityFingerprint}
          archiveVerified={archiveState.archive?.verified}
          mediaLabel={mediaLabel}
          activeVoiceRoom={activeVoiceRoom}
          onOpenDirectRoom={onOpenDirectRoom}
        />
      </section>
      <CreateSpaceDialog
        open={createDialogOpen}
        availableChannels={visibleRooms.filter((room) => room.kind === 'channel')}
        peers={data.peers}
        onOpenChange={onCloseCreate}
        onCreateChannel={onCreateChannel}
        onCreateGroup={onCreateGroup}
        onCreateDirect={onOpenDirectRoom}
      />
      <SettingsDialog
        open={settingsOpen}
        theme={preferences.theme}
        languagePreference={preferences.languagePreference}
        runtimeDraft={runtimeDraft}
        groups={reconciledGroups}
        rooms={visibleRooms}
        roomTypes={roomTypes}
        selectedGroupId={preferences.selectedGroupId}
        runtimeError={runtimeSettingsError}
        archiveLabel={archiveLabel}
        archiveFingerprint={archiveState.archive?.signerFingerprint ?? identityFingerprint}
        archiveVerified={archiveState.archive?.verified}
        saving={runtimeSettingsPending}
        onOpenChange={onOpenSettings}
        onThemeChange={onThemeChange}
        onLanguagePreferenceChange={onLanguagePreferenceChange}
        onRuntimeDraftChange={onRuntimeDraftChange}
        onSaveRuntime={onSaveRuntime}
        onSaveWorkspace={onSaveWorkspace}
        onRestoreStorage={onRestoreStorage}
        onResetOnboarding={onResetOnboarding}
      />
      <CallDock
        roomLabel={formatRoomTitle(activeRoom, copy.common.unknownRoom)}
        memberCount={visiblePeers.length}
        mediaState={mediaSession.state}
        onToggleMicrophone={mediaSession.toggleMicrophone}
        onStopScreenShare={mediaSession.stopScreenShare}
        onLeaveVoice={mediaSession.leaveVoiceRoom}
      />
    </main>
  )
}

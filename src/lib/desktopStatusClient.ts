import { invoke } from '@tauri-apps/api/core'
import {
  connectPeerInputSchema,
  joinVoiceRoomInputSchema,
  desktopSnapshotSchema,
  openDirectRoomInputSchema,
  publishMessageInputSchema,
  sendCallSignalInputSchema,
  startCallInputSchema,
  subscribeRoomInputSchema,
  updateRuntimeSettingsInputSchema,
  type SendCallSignalInput,
  type StartCallInput,
  type ConnectPeerInput,
  type DesktopSnapshot,
  type JoinVoiceRoomInput,
  type OpenDirectRoomInput,
  type PublishMessageInput,
  type SubscribeRoomInput,
  type UpdateRuntimeSettingsInput,
} from './schemas'

export class DesktopStatusClient {
  async getSnapshot(): Promise<DesktopSnapshot> {
    const payload = await invoke('desktop_snapshot')
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid desktop snapshot: ${result.error.message}`)
    }
    return result.data
  }

  async toggleRuntime(): Promise<DesktopSnapshot> {
    const payload = await invoke('toggle_runtime')
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid runtime toggle payload: ${result.error.message}`)
    }
    return result.data
  }

  async updateRuntimeSettings(
    input: UpdateRuntimeSettingsInput,
  ): Promise<DesktopSnapshot> {
    const parsed = updateRuntimeSettingsInputSchema.parse(input)
    const payload = await invoke('update_runtime_settings', { payload: parsed })
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid runtime settings payload: ${result.error.message}`)
    }
    return result.data
  }

  async subscribeRoom(input: SubscribeRoomInput): Promise<DesktopSnapshot> {
    const parsed = subscribeRoomInputSchema.parse(input)
    const payload = await invoke('subscribe_room', parsed)
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid subscribe payload: ${result.error.message}`)
    }
    return result.data
  }

  async unsubscribeRoom(input: SubscribeRoomInput): Promise<DesktopSnapshot> {
    const parsed = subscribeRoomInputSchema.parse(input)
    const payload = await invoke('unsubscribe_room', parsed)
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid unsubscribe payload: ${result.error.message}`)
    }
    return result.data
  }

  async connectPeer(input: ConnectPeerInput): Promise<DesktopSnapshot> {
    const parsed = connectPeerInputSchema.parse(input)
    const payload = await invoke('connect_peer', parsed)
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid connect payload: ${result.error.message}`)
    }
    return result.data
  }

  async openDirectRoom(input: OpenDirectRoomInput): Promise<DesktopSnapshot> {
    const parsed = openDirectRoomInputSchema.parse(input)
    const payload = await invoke('open_direct_room', parsed)
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid direct-room payload: ${result.error.message}`)
    }
    return result.data
  }

  async publishMessage(input: PublishMessageInput): Promise<DesktopSnapshot> {
    const parsed = publishMessageInputSchema.parse(input)
    const payload = await invoke('publish_message', parsed)
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid publish payload: ${result.error.message}`)
    }
    return result.data
  }

  async startCall(input: StartCallInput): Promise<DesktopSnapshot> {
    const parsed = startCallInputSchema.parse(input)
    const payload = await invoke('start_call', parsed)
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid start-call payload: ${result.error.message}`)
    }
    return result.data
  }

  async answerCall(): Promise<DesktopSnapshot> {
    const payload = await invoke('answer_call')
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid answer-call payload: ${result.error.message}`)
    }
    return result.data
  }

  async declineCall(): Promise<DesktopSnapshot> {
    const payload = await invoke('decline_call')
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid decline-call payload: ${result.error.message}`)
    }
    return result.data
  }

  async hangupCall(): Promise<DesktopSnapshot> {
    const payload = await invoke('hangup_call')
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid hangup-call payload: ${result.error.message}`)
    }
    return result.data
  }

  async sendCallSignal(input: SendCallSignalInput): Promise<DesktopSnapshot> {
    const parsed = sendCallSignalInputSchema.parse(input)
    const payload = await invoke('send_call_signal', { payload: parsed })
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid call-signal payload: ${result.error.message}`)
    }
    return result.data
  }

  async joinVoiceRoom(input: JoinVoiceRoomInput): Promise<DesktopSnapshot> {
    const parsed = joinVoiceRoomInputSchema.parse(input)
    const payload = await invoke('join_voice_room', parsed)
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid join-voice payload: ${result.error.message}`)
    }
    return result.data
  }

  async leaveVoiceRoom(): Promise<DesktopSnapshot> {
    const payload = await invoke('leave_voice_room')
    const result = desktopSnapshotSchema.safeParse(payload)
    if (!result.success) {
      throw new Error(`Invalid leave-voice payload: ${result.error.message}`)
    }
    return result.data
  }
}

export const desktopStatusClient = new DesktopStatusClient()

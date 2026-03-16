import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { desktopStatusClient } from '../lib/desktopStatusClient'
import type { DesktopSnapshot, SignalingEvent, VoiceRoom } from '../lib/schemas'

type MediaMode = 'voice' | 'screen'
type MediaStatus = 'idle' | 'requesting' | 'live' | 'error'

type RemotePeerStream = {
  peerId: string
  peerName: string
  stream: MediaStream
}

export type MediaSessionState = {
  activeRoomId: string | null
  activeModes: MediaMode[]
  microphoneEnabled: boolean
  screenSharingEnabled: boolean
  status: MediaStatus
  error: string | null
  audioStream: MediaStream | null
  displayStream: MediaStream | null
  remoteStreams: RemotePeerStream[]
}

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

const initialState: MediaSessionState = {
  activeRoomId: null,
  activeModes: [],
  microphoneEnabled: false,
  screenSharingEnabled: false,
  status: 'idle',
  error: null,
  audioStream: null,
  displayStream: null,
  remoteStreams: [],
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

function voiceSessionId(roomId: string) {
  return `voice:${roomId}`
}

function isCandidateInit(value: unknown): value is RTCIceCandidateInit {
  return typeof value === 'object' && value !== null && 'candidate' in value
}

export function useMediaSession(snapshot: DesktopSnapshot | undefined) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<MediaSessionState>(initialState)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const remoteStreamsRef = useRef<Map<string, RemotePeerStream>>(new Map())
  const processedSignalIdsRef = useRef<Set<string>>(new Set())
  const joinedRoomIdRef = useRef<string | null>(null)

  const selfPeerId = useMemo(
    () => snapshot?.peers.find((peer) => peer.status === 'self')?.id ?? null,
    [snapshot?.peers],
  )
  const joinedVoiceRoom = useMemo<VoiceRoom | null>(
    () => snapshot?.voiceRooms.find((room) => room.joined) ?? null,
    [snapshot?.voiceRooms],
  )

  useEffect(() => {
    return () => {
      for (const connection of peerConnectionsRef.current.values()) {
        connection.close()
      }
      peerConnectionsRef.current.clear()
      stopStream(audioStreamRef.current)
      stopStream(displayStreamRef.current)
    }
  }, [])

  useEffect(() => {
    joinedRoomIdRef.current = joinedVoiceRoom?.roomId ?? null
    setState((current) => ({
      ...current,
      activeRoomId: joinedVoiceRoom?.roomId ?? null,
      status: joinedVoiceRoom ? 'live' : current.status === 'error' ? 'error' : 'idle',
    }))
  }, [joinedVoiceRoom])

  useEffect(() => {
    if (!joinedVoiceRoom || !selfPeerId) {
      closeAllPeerConnections()
      setState((current) => ({
        ...current,
        remoteStreams: [],
      }))
      return
    }

    void syncVoiceParticipants(joinedVoiceRoom, selfPeerId)
  }, [joinedVoiceRoom, selfPeerId])

  useEffect(() => {
    if (!snapshot?.signalingEvents?.length || !joinedVoiceRoom) {
      return
    }

    const activeVoiceRoom = joinedVoiceRoom
    let cancelled = false

    async function processSignals(events: SignalingEvent[]) {
      for (const event of events) {
        if (cancelled || processedSignalIdsRef.current.has(event.id)) {
          continue
        }
        if (event.callId !== voiceSessionId(activeVoiceRoom.roomId)) {
          continue
        }
        processedSignalIdsRef.current.add(event.id)
        await routeSignalEvent(event, activeVoiceRoom.roomId)
      }
    }

    void processSignals(snapshot.signalingEvents)

    return () => {
      cancelled = true
    }
  }, [joinedVoiceRoom, snapshot?.signalingEvents])

  async function syncSnapshot(promise: Promise<DesktopSnapshot>) {
    const nextSnapshot = await promise
    queryClient.setQueryData(['desktop-snapshot'], nextSnapshot)
    return nextSnapshot
  }

  function refreshRemoteStreamsState() {
    const remoteStreams = Array.from(remoteStreamsRef.current.values()).sort((left, right) =>
      left.peerName.localeCompare(right.peerName),
    )
    setState((current) => ({
      ...current,
      remoteStreams,
    }))
  }

  function closePeerConnection(peerId: string) {
    peerConnectionsRef.current.get(peerId)?.close()
    peerConnectionsRef.current.delete(peerId)
    remoteStreamsRef.current.delete(peerId)
    refreshRemoteStreamsState()
  }

  function closeAllPeerConnections() {
    for (const connection of peerConnectionsRef.current.values()) {
      connection.close()
    }
    peerConnectionsRef.current.clear()
    remoteStreamsRef.current.clear()
    refreshRemoteStreamsState()
  }

  async function ensureAudioStream() {
    if (audioStreamRef.current) {
      return audioStreamRef.current
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    audioStreamRef.current = stream
    setState((current) => ({
      ...current,
      audioStream: stream,
      microphoneEnabled: true,
      activeModes: current.activeModes.includes('voice')
        ? current.activeModes
        : [...current.activeModes, 'voice'],
    }))
    return stream
  }

  async function ensureDisplayStream() {
    if (displayStreamRef.current) {
      return displayStreamRef.current
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    displayStreamRef.current = stream
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      void stopScreenShare()
    })
    setState((current) => ({
      ...current,
      displayStream: stream,
      screenSharingEnabled: true,
      activeModes: current.activeModes.includes('screen')
        ? current.activeModes
        : [...current.activeModes, 'screen'],
    }))
    return stream
  }

  async function sendSignal(
    roomId: string,
    targetPeerId: string,
    signalType: string,
    signalData: string,
  ) {
    await syncSnapshot(
      desktopStatusClient.sendCallSignal({
        targetPeerId,
        callId: voiceSessionId(roomId),
        room: roomId,
        signalType,
        signalData,
      }),
    )
  }

  async function createPeerConnection(roomId: string, peerId: string, peerName: string) {
    const existing = peerConnectionsRef.current.get(peerId)
    if (existing) {
      return existing
    }

    const connection = new RTCPeerConnection(rtcConfig)
    const remoteStream = new MediaStream()
    remoteStreamsRef.current.set(peerId, {
      peerId,
      peerName,
      stream: remoteStream,
    })
    refreshRemoteStreamsState()

    const audioStream = audioStreamRef.current
    const displayStream = displayStreamRef.current
    if (audioStream) {
      for (const track of audioStream.getTracks()) {
        connection.addTrack(track, audioStream)
      }
    }
    if (displayStream) {
      for (const track of displayStream.getTracks()) {
        connection.addTrack(track, displayStream)
      }
    }

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return
      }
      void sendSignal(roomId, peerId, 'ice-candidate', JSON.stringify(event.candidate.toJSON()))
    }

    connection.ontrack = (event) => {
      const target = remoteStreamsRef.current.get(peerId)
      if (!target) {
        return
      }
      for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
        if (!target.stream.getTracks().some((existingTrack) => existingTrack.id === track.id)) {
          target.stream.addTrack(track)
        }
      }
      refreshRemoteStreamsState()
    }

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
        closePeerConnection(peerId)
      }
    }

    peerConnectionsRef.current.set(peerId, connection)
    return connection
  }

  async function negotiateWithPeer(roomId: string, peerId: string) {
    const connection = peerConnectionsRef.current.get(peerId)
    if (!connection) {
      return
    }
    const offer = await connection.createOffer()
    await connection.setLocalDescription(offer)
    await sendSignal(roomId, peerId, 'offer', JSON.stringify(offer))
  }

  async function syncVoiceParticipants(room: VoiceRoom, localPeerId: string) {
    const remoteParticipants = room.participants.filter((participant) => !participant.isSelf)
    const activeIds = new Set(remoteParticipants.map((participant) => participant.peerId))

    for (const peerId of Array.from(peerConnectionsRef.current.keys())) {
      if (!activeIds.has(peerId)) {
        closePeerConnection(peerId)
      }
    }

    for (const participant of remoteParticipants) {
      await createPeerConnection(room.roomId, participant.peerId, participant.peerName)
      const shouldInitiate = localPeerId.localeCompare(participant.peerId) < 0
      if (shouldInitiate && !peerConnectionsRef.current.get(participant.peerId)?.currentLocalDescription) {
        await negotiateWithPeer(room.roomId, participant.peerId)
      }
    }
  }

  async function routeSignalEvent(event: SignalingEvent, roomId: string) {
    const room = snapshot?.voiceRooms.find((candidate) => candidate.roomId === roomId)
    const participant = room?.participants.find((candidate) => candidate.peerId === event.peerId)
    const peerName = participant?.peerName ?? event.peerId
    const connection = await createPeerConnection(roomId, event.peerId, peerName)

    if (event.signalType === 'offer') {
      const offer = new RTCSessionDescription(JSON.parse(event.signalData) as RTCSessionDescriptionInit)
      await connection.setRemoteDescription(offer)
      const answer = await connection.createAnswer()
      await connection.setLocalDescription(answer)
      await sendSignal(roomId, event.peerId, 'answer', JSON.stringify(answer))
      return
    }

    if (event.signalType === 'answer') {
      const answer = new RTCSessionDescription(JSON.parse(event.signalData) as RTCSessionDescriptionInit)
      if (!connection.currentRemoteDescription) {
        await connection.setRemoteDescription(answer)
      }
      return
    }

    if (event.signalType === 'ice-candidate') {
      const candidateData = JSON.parse(event.signalData) as unknown
      if (isCandidateInit(candidateData)) {
        await connection.addIceCandidate(new RTCIceCandidate(candidateData))
      }
    }
  }

  async function joinVoiceRoom(roomId: string, withScreen = false) {
    try {
      setState((current) => ({ ...current, status: 'requesting', error: null }))
      await ensureAudioStream()
      if (withScreen) {
        await ensureDisplayStream()
      }
      await syncSnapshot(desktopStatusClient.joinVoiceRoom({ room: roomId }))
      setState((current) => ({
        ...current,
        activeRoomId: roomId,
        status: 'live',
      }))
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : 'Voice join failed',
      }))
    }
  }

  async function leaveVoiceRoom() {
    try {
      await syncSnapshot(desktopStatusClient.leaveVoiceRoom())
    } finally {
      closeAllPeerConnections()
      stopStream(audioStreamRef.current)
      stopStream(displayStreamRef.current)
      audioStreamRef.current = null
      displayStreamRef.current = null
      setState(initialState)
    }
  }

  function toggleMicrophone() {
    if (!audioStreamRef.current) {
      return
    }
    const enabled = !state.microphoneEnabled
    for (const track of audioStreamRef.current.getAudioTracks()) {
      track.enabled = enabled
    }
    setState((current) => ({
      ...current,
      microphoneEnabled: enabled,
    }))
  }

  async function startScreenShare() {
    const roomId = joinedRoomIdRef.current
    if (!roomId) {
      return
    }
    try {
      const displayStream = await ensureDisplayStream()
      for (const [peerId, connection] of peerConnectionsRef.current.entries()) {
        for (const track of displayStream.getTracks()) {
          connection.addTrack(track, displayStream)
        }
        await negotiateWithPeer(roomId, peerId)
      }
      setState((current) => ({
        ...current,
        screenSharingEnabled: true,
        activeModes: current.activeModes.includes('screen')
          ? current.activeModes
          : [...current.activeModes, 'screen'],
      }))
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : 'Screen share failed',
      }))
    }
  }

  async function stopScreenShare() {
    const roomId = joinedRoomIdRef.current
    const displayStream = displayStreamRef.current
    if (!roomId || !displayStream) {
      return
    }
    const trackIds = new Set(displayStream.getTracks().map((track) => track.id))
    stopStream(displayStream)
    displayStreamRef.current = null

    for (const [peerId, connection] of peerConnectionsRef.current.entries()) {
      for (const sender of connection.getSenders()) {
        if (sender.track && trackIds.has(sender.track.id)) {
          await sender.replaceTrack(null)
        }
      }
      await negotiateWithPeer(roomId, peerId)
    }

    setState((current) => ({
      ...current,
      displayStream: null,
      screenSharingEnabled: false,
      activeModes: current.activeModes.filter((mode) => mode !== 'screen'),
    }))
  }

  return {
    state,
    joinVoiceRoom,
    leaveVoiceRoom,
    toggleMicrophone,
    startScreenShare,
    stopScreenShare,
  }
}

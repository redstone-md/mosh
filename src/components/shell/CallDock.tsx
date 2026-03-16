import { Mic, MicOff, MonitorUp, PhoneOff } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { MediaSessionState } from '../../hooks/useMediaSession'
import { Button } from '../ui/button'

type CallDockProps = {
  roomLabel: string
  memberCount: number
  mediaState: MediaSessionState
  onToggleMicrophone: () => void
  onStopScreenShare: () => void
  onLeaveVoice: () => void
}

export function CallDock({
  roomLabel,
  memberCount,
  mediaState,
  onToggleMicrophone,
  onStopScreenShare,
  onLeaveVoice,
}: CallDockProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const remoteAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map())

  useEffect(() => {
    if (!videoRef.current) {
      return
    }
    videoRef.current.srcObject = mediaState.displayStream
  }, [mediaState.displayStream])

  useEffect(() => {
    for (const remote of mediaState.remoteStreams) {
      const video = remoteVideoRefs.current.get(remote.peerId)
      const audio = remoteAudioRefs.current.get(remote.peerId)
      if (video) {
        video.srcObject = remote.stream
      }
      if (audio) {
        audio.srcObject = remote.stream
      }
    }
  }, [mediaState.remoteStreams])

  if (mediaState.activeModes.length === 0) {
    return null
  }

  return (
    <section className="fixed bottom-4 right-4 z-40 w-[320px] rounded-lg border border-border bg-[var(--panel)] shadow-2xl">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-semibold">{roomLabel}</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {memberCount} members · {mediaState.remoteStreams.length} connected · {mediaState.activeModes.join(' + ')}
        </p>
      </div>

      {mediaState.remoteStreams.length > 0 ? (
        <div className="grid grid-cols-1 gap-px border-b border-border bg-black sm:grid-cols-2">
          {mediaState.remoteStreams.map((remote) => (
            <div key={remote.peerId} className="relative bg-black">
              <video
                ref={(node) => {
                  if (node) {
                    remoteVideoRefs.current.set(remote.peerId, node)
                  } else {
                    remoteVideoRefs.current.delete(remote.peerId)
                  }
                }}
                autoPlay
                playsInline
                className="aspect-video w-full object-cover"
              />
              <audio
                ref={(node) => {
                  if (node) {
                    remoteAudioRefs.current.set(remote.peerId, node)
                  } else {
                    remoteAudioRefs.current.delete(remote.peerId)
                  }
                }}
                autoPlay
                playsInline
              />
              <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
                {remote.peerName}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {mediaState.displayStream ? (
        <div className="border-b border-border bg-black">
          <video ref={videoRef} autoPlay muted playsInline className="aspect-video w-full object-cover" />
        </div>
      ) : null}

      <div className="space-y-3 px-4 py-4">
        {mediaState.error ? (
          <p className="text-sm text-[var(--danger)]">{mediaState.error}</p>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">
            Voice session is active for this room.
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" onClick={onToggleMicrophone} title="Toggle microphone">
            {mediaState.microphoneEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </Button>
          {mediaState.activeModes.includes('screen') ? (
            <Button variant="outline" onClick={onStopScreenShare}>
              <MonitorUp className="h-4 w-4" />
              Stop share
            </Button>
          ) : null}
          <Button variant="destructive" onClick={onLeaveVoice}>
            <PhoneOff className="h-4 w-4" />
            Leave
          </Button>
        </div>
      </div>
    </section>
  )
}

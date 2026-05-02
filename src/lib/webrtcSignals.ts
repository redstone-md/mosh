export const MAX_WEBRTC_SIGNAL_DATA_LENGTH = 400_000

const WEBRTC_SIGNAL_TYPES = ['offer', 'answer', 'ice-candidate'] as const

type WebRtcSignalType = (typeof WEBRTC_SIGNAL_TYPES)[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseSignalJson(signalData: string): unknown | null {
  if (signalData.length > MAX_WEBRTC_SIGNAL_DATA_LENGTH) {
    return null
  }

  try {
    return JSON.parse(signalData) as unknown
  } catch {
    return null
  }
}

export function isWebRtcSignalType(value: string): value is WebRtcSignalType {
  return WEBRTC_SIGNAL_TYPES.includes(value as WebRtcSignalType)
}

export function parseSessionDescriptionInit(
  signalData: string,
  expectedType: 'offer' | 'answer'
): RTCSessionDescriptionInit | null {
  const parsed = parseSignalJson(signalData)
  if (!isRecord(parsed) || parsed.type !== expectedType || typeof parsed.sdp !== 'string') {
    return null
  }

  return {
    type: expectedType,
    sdp: parsed.sdp,
  }
}

export function parseIceCandidateInit(signalData: string): RTCIceCandidateInit | null {
  const parsed = parseSignalJson(signalData)
  if (!isRecord(parsed) || typeof parsed.candidate !== 'string') {
    return null
  }

  return {
    candidate: parsed.candidate,
    sdpMLineIndex: typeof parsed.sdpMLineIndex === 'number' ? parsed.sdpMLineIndex : null,
    sdpMid: typeof parsed.sdpMid === 'string' ? parsed.sdpMid : null,
    usernameFragment: typeof parsed.usernameFragment === 'string' ? parsed.usernameFragment : undefined,
  }
}

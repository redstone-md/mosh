import { describe, expect, it } from 'vitest'

import {
  MAX_WEBRTC_SIGNAL_DATA_LENGTH,
  isWebRtcSignalType,
  parseIceCandidateInit,
  parseSessionDescriptionInit,
} from './webrtcSignals'

describe('webrtcSignals', () => {
  it('rejects malformed session descriptions without throwing', () => {
    expect(parseSessionDescriptionInit('{', 'offer')).toBeNull()
    expect(parseSessionDescriptionInit(JSON.stringify({ type: 'answer', sdp: 'v=0' }), 'offer')).toBeNull()
    expect(parseSessionDescriptionInit(JSON.stringify({ type: 'offer' }), 'offer')).toBeNull()
  })

  it('parses expected session descriptions', () => {
    expect(parseSessionDescriptionInit(JSON.stringify({ type: 'offer', sdp: 'v=0' }), 'offer')).toEqual({
      type: 'offer',
      sdp: 'v=0',
    })
  })

  it('rejects malformed and oversized ICE candidates without throwing', () => {
    expect(parseIceCandidateInit('{')).toBeNull()
    expect(parseIceCandidateInit(JSON.stringify({ candidate: 1 }))).toBeNull()
    expect(parseIceCandidateInit('x'.repeat(MAX_WEBRTC_SIGNAL_DATA_LENGTH + 1))).toBeNull()
  })

  it('allows only supported signal types', () => {
    expect(isWebRtcSignalType('offer')).toBe(true)
    expect(isWebRtcSignalType('renegotiate')).toBe(false)
  })
})

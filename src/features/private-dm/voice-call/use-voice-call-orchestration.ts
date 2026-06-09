import { getCurrentWindow } from "@tauri-apps/api/window";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActiveCall,
  NativeMessagingGateway,
  SessionSnapshot,
} from "../native/native-messaging-gateway";
import {
  CALLEE_DIRECTION_BIT,
  CALLER_DIRECTION_BIT,
  bytesFromBase64,
  bytesToBase64,
  importCallKey,
  openFrame,
  sealFrame,
} from "./frame-crypto";
import { JitterBuffer } from "./jitter-buffer";
import {
  isCallAudioSupported,
  startVoiceCapture,
  type VoiceCaptureHandle,
} from "./audio-capture";
import {
  startVoicePlayback,
  type VoicePlaybackHandle,
} from "./audio-playback";

const CALL_FRAME_POLL_MS = 20;

interface UseVoiceCallOrchestrationOptions {
  readonly gateway: NativeMessagingGateway;
  readonly sessions: readonly SessionSnapshot[];
  readonly activeSession: SessionSnapshot | null;
  readonly notificationsReady: () => boolean;
  readonly onError: (message: string | undefined) => void;
}

interface VoiceCallOrchestration {
  readonly pendingCallSession: SessionSnapshot | undefined;
  readonly activeCall: ActiveCall | null;
  readonly activeCallSessionId: string | null;
  readonly callSupported: boolean;
  readonly callMuted: boolean;
  readonly startCall: (sessionId: string) => void;
  readonly acceptCall: (sessionId: string, callId: string) => void;
  readonly declineCall: (sessionId: string, callId: string, reason: string) => void;
  readonly endCall: (sessionId: string, callId: string, reason: string) => void;
  readonly toggleMute: () => void;
}

export function useVoiceCallOrchestration({
  gateway,
  sessions,
  activeSession,
  notificationsReady,
  onError,
}: UseVoiceCallOrchestrationOptions): VoiceCallOrchestration {
  const callCaptureRef = useRef<VoiceCaptureHandle | null>(null);
  const callPlaybackRef = useRef<VoicePlaybackHandle | null>(null);
  const callKeyRef = useRef<CryptoKey | null>(null);
  const callSeqRef = useRef<bigint>(0n);
  const callJitterRef = useRef<JitterBuffer | null>(null);
  const callPollRef = useRef<number | undefined>(undefined);
  const callMutedRef = useRef(false);
  const [callMuted, setCallMuted] = useState(false);

  const pendingCallSession = sessions.find((session) => session.pending_call);
  const activeCall = activeSession?.active_call ?? null;
  const activeCallSessionId = activeSession?.session_id ?? null;
  const activeCallId = activeCall?.call_id ?? null;
  const activeCallKey = activeCall?.key_b64 ?? null;
  const activeCallNoncePrefix = activeCall?.nonce_prefix_b64 ?? null;
  const activeCallDirection = activeCall?.direction ?? null;
  const pendingCallId = pendingCallSession?.pending_call?.call_id ?? null;
  const pendingCallDisplayName = pendingCallSession?.display_name ?? null;

  const startCall = useCallback(
    (sessionId: string) => {
      void gateway.callStart(sessionId).catch((err) => {
        onError(err instanceof Error ? err.message : "Could not start call");
      });
    },
    [gateway, onError],
  );

  const acceptCall = useCallback(
    (sessionId: string, callId: string) => {
      void gateway.callAccept(sessionId, callId).catch((err) => {
        onError(err instanceof Error ? err.message : "Could not accept call");
      });
    },
    [gateway, onError],
  );

  const declineCall = useCallback(
    (sessionId: string, callId: string, reason: string) => {
      void gateway.callDecline(sessionId, callId, reason).catch((err) => {
        onError(err instanceof Error ? err.message : "Could not decline call");
      });
    },
    [gateway, onError],
  );

  const endCall = useCallback(
    (sessionId: string, callId: string, reason: string) => {
      void gateway.callEnd(sessionId, callId, reason).catch((err) => {
        onError(err instanceof Error ? err.message : "Could not end call");
      });
    },
    [gateway, onError],
  );

  const toggleMute = useCallback(() => {
    setCallMuted((current) => {
      const next = !current;
      callMutedRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (
      !activeCallSessionId ||
      !activeCallId ||
      !activeCallKey ||
      !activeCallNoncePrefix ||
      !activeCallDirection
    ) {
      return;
    }
    let cancelled = false;
    const direction =
      activeCallDirection === "caller"
        ? CALLER_DIRECTION_BIT
        : CALLEE_DIRECTION_BIT;
    const sessionId = activeCallSessionId;
    const callId = activeCallId;
    const noncePrefix = activeCallNoncePrefix;
    void (async () => {
      try {
        callKeyRef.current = await importCallKey(activeCallKey);
        callSeqRef.current = 0n;
        callMutedRef.current = false;
        setCallMuted(false);
        callJitterRef.current = new JitterBuffer();
        callPlaybackRef.current = await startVoicePlayback();
        callCaptureRef.current = await startVoiceCapture((frame) => {
          if (cancelled || !callKeyRef.current || callMutedRef.current) {
            return;
          }
          void (async () => {
            const seal = await sealFrame(
              callKeyRef.current!,
              noncePrefix,
              callSeqRef.current,
              direction,
              frame,
            );
            callSeqRef.current += 1n;
            try {
              await gateway.callSendFrame(
                sessionId,
                callId,
                bytesToBase64(seal),
              );
            } catch (err) {
              console.warn("[voice-call] send failed", err);
            }
          })();
        });
        callPollRef.current = window.setInterval(() => {
          void (async () => {
            try {
              const frames = await gateway.callDrainFrames(sessionId, callId);
              if (frames.length === 0 || !callKeyRef.current) {
                return;
              }
              for (const frameB64 of frames) {
                const opened = await openFrame(
                  callKeyRef.current,
                  noncePrefix,
                  bytesFromBase64(frameB64),
                );
                if (opened) {
                  callJitterRef.current?.push({
                    seq: opened.seq,
                    payload: opened.payload,
                  });
                }
              }
              const ready = callJitterRef.current?.drainReady() ?? [];
              for (const buffered of ready) {
                callPlaybackRef.current?.pushFrame(buffered.payload);
              }
            } catch (err) {
              console.warn("[voice-call] poll failed", err);
            }
          })();
        }, CALL_FRAME_POLL_MS);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Voice call setup failed");
        endCall(sessionId, callId, "setup_failed");
      }
    })();

    return () => {
      cancelled = true;
      if (callPollRef.current !== undefined) {
        window.clearInterval(callPollRef.current);
        callPollRef.current = undefined;
      }
      void callCaptureRef.current?.stop();
      void callPlaybackRef.current?.stop();
      callCaptureRef.current = null;
      callPlaybackRef.current = null;
      callKeyRef.current = null;
      callSeqRef.current = 0n;
      callJitterRef.current = null;
      setCallMuted(false);
      callMutedRef.current = false;
    };
  }, [
    activeCallSessionId,
    activeCallId,
    activeCallKey,
    activeCallNoncePrefix,
    activeCallDirection,
    endCall,
    gateway,
    onError,
  ]);

  useEffect(() => {
    if (!pendingCallId || !pendingCallDisplayName) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const focused = await getCurrentWindow().isFocused();
        if (cancelled || focused || !notificationsReady()) {
          return;
        }
        sendNotification({
          title: "Mosh",
          body: `Incoming call from ${pendingCallDisplayName}`,
        });
      } catch {
        // Notification host unavailable; the in-app modal is the user's signal.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notificationsReady, pendingCallId, pendingCallDisplayName]);

  return {
    pendingCallSession,
    activeCall,
    activeCallSessionId,
    callSupported: isCallAudioSupported(),
    callMuted,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
  };
}

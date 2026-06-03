import { IconPhoneOff } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { startRingtone, type RingtoneHandle } from "./ringtone";

/**
 * Caller-side "ringing" UI shown while waiting for the peer to answer. Plays a
 * dial tone (reusing the ringtone synth) and offers a single cancel/hang-up
 * action. The active-call overlay takes over once the peer accepts.
 */
export function OutgoingCallModal({
  callId,
  peerLabel,
  onCancel,
}: {
  callId: string;
  peerLabel: string;
  onCancel: () => void;
}) {
  const ringtoneRef = useRef<RingtoneHandle | null>(null);

  useEffect(() => {
    try {
      ringtoneRef.current = startRingtone();
    } catch {
      ringtoneRef.current = null;
    }
    return () => {
      ringtoneRef.current?.stop();
      ringtoneRef.current = null;
    };
  }, [callId]);

  return (
    <div
      className="call-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Outgoing call"
    >
      <div className="call-modal-card">
        <strong className="call-modal-peer">{peerLabel}</strong>
        <span className="call-modal-status">Calling…</span>
        <div className="call-modal-actions">
          <button
            type="button"
            className="call-btn call-btn-decline"
            aria-label="Cancel call"
            onClick={onCancel}
          >
            <IconPhoneOff size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

import { IconPhone, IconPhoneOff } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import type { PendingCall } from "../native/native-messaging-gateway";
import { useModalFocus } from "../use-modal-focus";
import { NO_ANSWER_TIMEOUT_MS } from "./call-state";
import { startRingtone, type RingtoneHandle } from "./ringtone";

export function IncomingCallModal({
  pending,
  peerLabel,
  onAccept,
  onDecline,
}: {
  pending: PendingCall;
  peerLabel: string;
  onAccept: () => void;
  onDecline: (reason: string) => void;
}) {
  const ringtoneRef = useRef<RingtoneHandle | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const modalRef = useModalFocus(() => onDecline("declined"));

  useEffect(() => {
    try {
      ringtoneRef.current = startRingtone();
    } catch {
      ringtoneRef.current = null;
    }
    timerRef.current = window.setTimeout(
      () => onDecline("no_answer"),
      NO_ANSWER_TIMEOUT_MS,
    );
    return () => {
      ringtoneRef.current?.stop();
      ringtoneRef.current = null;
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [pending.call_id, onDecline]);

  return (
    <div
      ref={modalRef}
      className="call-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Incoming call"
      tabIndex={-1}
    >
      <div className="call-modal-card">
        <strong className="call-modal-peer">{peerLabel}</strong>
        <span className="call-modal-status">Incoming voice call…</span>
        <div className="call-modal-actions">
          <button
            type="button"
            className="call-btn call-btn-decline"
            aria-label="Decline call"
            onClick={() => onDecline("declined")}
          >
            <IconPhoneOff size={20} />
          </button>
          <button
            type="button"
            className="call-btn call-btn-accept"
            aria-label="Accept call"
            onClick={onAccept}
          >
            <IconPhone size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

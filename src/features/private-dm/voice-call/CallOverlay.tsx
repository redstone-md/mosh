import { IconMicrophone, IconMicrophoneOff, IconPhoneOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ActiveCall } from "../native/native-messaging-gateway";
import { useModalFocus } from "../use-modal-focus";

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function CallOverlay({
  active,
  peerLabel,
  muted,
  onToggleMute,
  onHangUp,
}: {
  active: ActiveCall;
  peerLabel: string;
  muted: boolean;
  onToggleMute: () => void;
  onHangUp: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const modalRef = useModalFocus(onHangUp);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = Math.max(0, now - active.started_at_ms);

  return (
    <div
      ref={modalRef}
      className="call-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Active call"
      tabIndex={-1}
    >
      <div className="call-overlay-card">
        <strong className="call-overlay-peer">{peerLabel}</strong>
        <span className="call-overlay-timer">{formatClock(elapsed)}</span>
        <div className="call-overlay-actions">
          <button
            type="button"
            className={`call-btn ${muted ? "call-btn-muted" : ""}`}
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={onToggleMute}
          >
            {muted ? <IconMicrophoneOff size={18} /> : <IconMicrophone size={18} />}
          </button>
          <button
            type="button"
            className="call-btn call-btn-decline"
            aria-label="Hang up"
            onClick={onHangUp}
          >
            <IconPhoneOff size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

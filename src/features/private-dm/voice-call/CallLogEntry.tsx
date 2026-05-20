import { IconPhone, IconPhoneOff } from "@tabler/icons-react";
import type { CallEvent } from "../native/native-messaging-gateway";

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total === 0) {
    return "";
  }
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function CallLogEntry({ event }: { event: CallEvent }) {
  const missed = event.kind === "missed";
  const duration = formatDuration(event.duration_ms);
  return (
    <span className={`call-log-entry ${missed ? "call-log-missed" : ""}`}>
      {missed ? <IconPhoneOff size={14} /> : <IconPhone size={14} />}
      <span>
        {missed ? "Missed call" : "Call ended"}
        {duration ? ` · ${duration}` : ""}
      </span>
    </span>
  );
}

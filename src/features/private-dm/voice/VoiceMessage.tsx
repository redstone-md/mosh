import { IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { localFileSrc, streamingMediaSrc } from "../attachments";
import type {
  AttachmentDescriptor,
  AttachmentView,
} from "../native/native-messaging-gateway";
import { peaksFromBase64, WAVEFORM_BUCKETS } from "./waveform";

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Draws the static waveform with a played/unplayed split at `progress`. */
function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: Uint8Array,
  progress: number,
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  const barWidth = width / WAVEFORM_BUCKETS;
  const playedBars = Math.round(progress * WAVEFORM_BUCKETS);
  for (let i = 0; i < WAVEFORM_BUCKETS; i += 1) {
    const amplitude = (peaks[i] ?? 0) / 255;
    const barHeight = Math.max(2, amplitude * height);
    context.fillStyle = i < playedBars ? "#4f8cff" : "#9aa3b2";
    context.fillRect(
      i * barWidth + barWidth * 0.2,
      (height - barHeight) / 2,
      barWidth * 0.6,
      barHeight,
    );
  }
}

/**
 * Inline voice-message player. Shows the waveform immediately from the
 * descriptor's peaks; plays the audio over the streaming protocol while
 * the transfer is still in progress, or from the local file once complete.
 */
export function VoiceMessage({
  descriptor,
  view,
  surface,
  host,
}: {
  descriptor: AttachmentDescriptor;
  view: AttachmentView | undefined;
  surface: "dm" | "group" | "channel";
  host: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);

  const durationMs = descriptor.voice?.duration_ms ?? 0;
  const peaks = peaksFromBase64(descriptor.voice?.peaks_b64 ?? "");
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  const src = view?.local_path
    ? localFileSrc(view.local_path)
    : streamingMediaSrc(surface, host, descriptor.attachment_id);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      drawWaveform(canvas, peaks, progress);
    }
  }, [peaks, progress]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  };

  const seek = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas || durationMs === 0) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    audio.currentTime = (ratio * durationMs) / 1000;
  };

  return (
    <div className="voice-message">
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPositionMs(0);
        }}
        onTimeUpdate={(event) =>
          setPositionMs(event.currentTarget.currentTime * 1000)
        }
      />
      <button
        type="button"
        className="voice-message-play"
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        onClick={toggle}
      >
        {playing ? (
          <IconPlayerPauseFilled size={18} />
        ) : (
          <IconPlayerPlayFilled size={18} />
        )}
      </button>
      <canvas
        ref={canvasRef}
        className="voice-message-wave"
        width={192}
        height={36}
        onClick={seek}
      />
      <span className="voice-message-time">
        {formatClock(playing || positionMs > 0 ? positionMs : durationMs)}
      </span>
    </div>
  );
}

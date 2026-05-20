import {
  IconMicrophone,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconSend,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { analyzeAudio, peaksToBase64, type AudioAnalysis } from "./waveform";
import { Recording, VoiceRecorder } from "./voice-recorder";

/** Voice payload handed to the send callback. */
export interface VoiceSend {
  readonly blob: Blob;
  readonly mime: string;
  readonly durationMs: number;
  readonly peaksB64: string;
}

type Phase = "idle" | "recording" | "review";

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Microphone control for the composer. Tap to record, tap to stop, then
 * review (play / discard / send). Renders nothing if recording is
 * unsupported so the rest of the composer is unaffected.
 */
export function VoiceComposer({
  disabled,
  onSend,
  onError,
}: {
  disabled: boolean;
  onSend: (voice: VoiceSend) => void;
  onError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const recordingRef = useRef<Recording | null>(null);
  const analysisRef = useRef<AudioAnalysis | null>(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | undefined>(undefined);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | undefined>(undefined);

  const supported = VoiceRecorder.isSupported();

  const clearTick = () => {
    if (tickRef.current !== undefined) {
      window.clearInterval(tickRef.current);
      tickRef.current = undefined;
    }
  };

  const revokePreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = undefined;
    }
  };

  useEffect(() => {
    return () => {
      clearTick();
      revokePreview();
      recorderRef.current?.cancel();
    };
  }, []);

  const finishRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder) {
      return;
    }
    clearTick();
    try {
      const recording = await recorder.stop();
      recordingRef.current = recording;
      analysisRef.current = await analyzeAudio(recording.blob);
      setPhase("review");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Recording failed");
      setPhase("idle");
    }
  };

  const startRecording = async () => {
    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Could not access the microphone",
      );
      return;
    }
    startedAtRef.current = Date.now();
    setElapsed(0);
    setPhase("recording");
    tickRef.current = window.setInterval(() => {
      setElapsed(Date.now() - startedAtRef.current);
    }, 200);
    recorder.onMaxDuration(() => void finishRecording());
  };

  const discard = () => {
    revokePreview();
    recordingRef.current = null;
    analysisRef.current = null;
    setPhase("idle");
  };

  const send = () => {
    const recording = recordingRef.current;
    const analysis = analysisRef.current;
    if (!recording || !analysis) {
      return;
    }
    onSend({
      blob: recording.blob,
      mime: recording.mime,
      durationMs: analysis.durationMs,
      peaksB64: peaksToBase64(analysis.peaks),
    });
    discard();
  };

  const playPreview = () => {
    const recording = recordingRef.current;
    if (!recording) {
      return;
    }
    revokePreview();
    previewUrlRef.current = URL.createObjectURL(recording.blob);
    if (audioRef.current) {
      audioRef.current.src = previewUrlRef.current;
      void audioRef.current.play();
    }
  };

  if (!supported) {
    return null;
  }

  if (phase === "idle") {
    return (
      <button
        type="button"
        className="composer-mic"
        aria-label="Record a voice message"
        title="Record a voice message"
        disabled={disabled}
        onClick={() => void startRecording()}
      >
        <IconMicrophone size={16} />
      </button>
    );
  }

  if (phase === "recording") {
    return (
      <div className="voice-composer voice-composer-recording" role="group">
        <span className="voice-dot" aria-hidden="true" />
        <span className="voice-timer">{formatElapsed(elapsed)}</span>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label="Discard recording"
          onClick={() => {
            clearTick();
            recorderRef.current?.cancel();
            setPhase("idle");
          }}
        >
          <IconTrash size={15} />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label="Stop recording"
          onClick={() => void finishRecording()}
        >
          <IconPlayerStopFilled size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="voice-composer voice-composer-review" role="group">
      <audio ref={audioRef} hidden />
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label="Play recording"
        onClick={playPreview}
      >
        <IconPlayerPlayFilled size={15} />
      </button>
      <span className="voice-timer">
        {formatElapsed(analysisRef.current?.durationMs ?? 0)}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label="Discard recording"
        onClick={discard}
      >
        <IconTrash size={15} />
      </button>
      <button
        type="button"
        className="btn btn-icon voice-send"
        aria-label="Send voice message"
        onClick={send}
      >
        <IconSend size={15} />
      </button>
    </div>
  );
}

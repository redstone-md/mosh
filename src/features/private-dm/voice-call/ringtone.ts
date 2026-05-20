/**
 * Lightweight call ringtone synthesised with Web Audio — no assets to ship.
 * Pattern: two-tone trill, 0.4 s on / 0.6 s off, repeated.
 */

export interface RingtoneHandle {
  stop(): void;
}

export function startRingtone(): RingtoneHandle {
  const context = new AudioContext();
  const gain = context.createGain();
  gain.gain.value = 0.0001;
  gain.connect(context.destination);

  const osc1 = context.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = 440;
  const osc2 = context.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = 480;
  osc1.connect(gain);
  osc2.connect(gain);
  osc1.start();
  osc2.start();

  const start = context.currentTime;
  for (let beat = 0; beat < 30; beat += 1) {
    const ringStart = start + beat * 1.0;
    gain.gain.setValueAtTime(0.0001, ringStart);
    gain.gain.exponentialRampToValueAtTime(0.15, ringStart + 0.05);
    gain.gain.setValueAtTime(0.15, ringStart + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, ringStart + 0.45);
  }

  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    try {
      osc1.stop();
      osc2.stop();
    } catch {
      // already stopped
    }
    void context.close();
  };

  return { stop };
}

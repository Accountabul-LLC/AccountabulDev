import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { greenRoomIsReady, type DeviceCheck, type GreenRoomChecks } from "@/lib/conference/studio";

function CheckRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: DeviceCheck;
  detail: string;
}) {
  const tone =
    status === "ok"
      ? "text-emerald-700 dark:text-emerald-400"
      : status === "fail"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <li className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="font-medium">{label}</span>
      <span className={`text-sm ${tone}`}>
        {status === "ok" ? "Connected" : status === "fail" ? "Needs attention" : "Not checked"} —{" "}
        {detail}
      </span>
    </li>
  );
}

export function GreenRoom({ onReadyChange }: { onReadyChange?: (ready: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [checks, setChecks] = useState<GreenRoomChecks>({
    camera: "idle",
    mic: "idle",
    speaker: "idle",
  });
  const [micLevel, setMicLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onReadyChange?.(greenRoomIsReady(checks));
  }, [checks, onReadyChange]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  async function startCameraAndMic() {
    setError(null);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      const videoOk = stream.getVideoTracks().some((track) => track.readyState === "live");
      const audioOk = stream.getAudioTracks().some((track) => track.readyState === "live");
      setChecks((current) => ({
        ...current,
        camera: videoOk ? "ok" : "fail",
        mic: audioOk ? "ok" : "fail",
      }));
      if (audioOk) watchMic(stream);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not open camera or microphone.";
      setError(message);
      setChecks((current) => ({ ...current, camera: "fail", mic: "fail" }));
    }
  }

  function watchMic(stream: MediaStream) {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const sample of data) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      setMicLevel(Math.min(100, Math.round(Math.sqrt(sum / data.length) * 180)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      cancelAnimationFrame(frame);
      void context.close();
    });
  }

  async function playSpeakerTone() {
    setError(null);
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 440;
      gain.gain.value = 0.08;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.45);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await context.close();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Speaker test failed.";
      setError(message);
      setChecks((current) => ({ ...current, speaker: "fail" }));
    }
  }

  const ready = greenRoomIsReady(checks);

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg border border-border bg-black">
        <video
          ref={videoRef}
          className="aspect-video w-full object-cover"
          playsInline
          muted
          autoPlay
          aria-label="Host camera preview"
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Microphone level</p>
        <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
          <div className="h-full bg-accent transition-[width]" style={{ width: `${micLevel}%` }} />
        </div>
      </div>
      <ul className="space-y-2">
        <CheckRow
          label="Camera"
          status={checks.camera}
          detail={
            checks.camera === "ok"
              ? "Preview is private until you go live."
              : "Enable the camera to preview."
          }
        />
        <CheckRow
          label="Microphone"
          status={checks.mic}
          detail={
            checks.mic === "ok"
              ? "Speak and watch the meter."
              : "Allow microphone access, then retest."
          }
        />
        <CheckRow
          label="Sound"
          status={checks.speaker}
          detail={
            checks.speaker === "ok"
              ? "You confirmed the tone."
              : "Play the tone, then confirm you heard it."
          }
        />
      </ul>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void startCameraAndMic()}>
          {checks.camera === "ok" ? "Retest camera and mic" : "Check camera and mic"}
        </Button>
        <Button type="button" variant="outline" onClick={() => void playSpeakerTone()}>
          Play sound check
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setChecks((current) => ({ ...current, speaker: "ok" }))}
        >
          I heard it
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            setChecks({
              camera: "fail",
              mic: "fail",
              speaker: "fail",
            })
          }
        >
          Mark all failed
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {ready
          ? "Green room is ready. Going live is the next gate and will not start from here."
          : "This preview is not public. Fix each check before a live countdown."}
      </p>
    </div>
  );
}

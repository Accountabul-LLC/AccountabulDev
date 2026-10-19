import { useEffect, useRef } from "react";

/**
 * Renders one participant's media. Video is always muted locally for self so the
 * host never hears their own echo; remote audio plays through a separate element.
 */
export function MediaTile({
  videoTrack,
  audioTrack,
  name,
  isSelf = false,
  label,
  className = "",
}: {
  videoTrack: MediaStreamTrack | null | undefined;
  audioTrack: MediaStreamTrack | null | undefined;
  name: string;
  isSelf?: boolean;
  label?: string;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (!videoTrack) {
      element.srcObject = null;
      return;
    }
    element.srcObject = new MediaStream([videoTrack]);
    void element.play().catch(() => undefined);
  }, [videoTrack]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    if (!audioTrack || isSelf) {
      element.srcObject = null;
      return;
    }
    element.srcObject = new MediaStream([audioTrack]);
    void element.play().catch(() => undefined);
  }, [audioTrack, isSelf]);

  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-border bg-black ${className}`}
    >
      <video
        ref={videoRef}
        className="aspect-video w-full object-cover"
        playsInline
        autoPlay
        muted
        aria-label={`${name} video`}
      />
      {!videoTrack ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
          {name} — camera off
        </div>
      ) : null}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
        <span className="text-sm font-medium text-white">{name}</span>
        {label ? (
          <span className="rounded bg-white/15 px-2 py-0.5 text-xs text-white">{label}</span>
        ) : null}
      </div>
      {!isSelf ? <audio ref={audioRef} autoPlay /> : null}
    </div>
  );
}

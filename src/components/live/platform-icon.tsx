// Source marks for off-platform chat. Simplified glyphs in each platform's own color,
// used only to say where a message came from.

const LABEL: Record<string, string> = { youtube: "YouTube", twitch: "Twitch", kick: "Kick" };

export function PlatformIcon({
  source,
  className = "h-3.5 w-3.5",
}: {
  source: string;
  className?: string;
}) {
  const label = LABEL[source];
  if (!label) return null;
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={`From ${label}`}>
      <title>{`From ${label}`}</title>
      {source === "youtube" ? (
        <>
          <rect x="1" y="4.5" width="22" height="15" rx="4.5" fill="#FF0000" />
          <path d="M10 8.8v6.4l5.6-3.2z" fill="#fff" />
        </>
      ) : source === "twitch" ? (
        <>
          <path d="M4.5 2 2.5 6v14h5v2.5h2.8L12.8 20h4L22 14.8V2z" fill="#9146FF" />
          <path d="M6 4h14v10l-3.2 3.2h-4.6L9.8 19.6v-2.4H6z" fill="#fff" />
          <path d="M11 7.5h2v5h-2zm5 0h2v5h-2z" fill="#9146FF" />
        </>
      ) : (
        <>
          <rect x="1" y="1" width="22" height="22" rx="4" fill="#53FC18" />
          <path d="M6 5h4v4h2V7h2V5h4v5h-2v2h-2v0h2v2h2v5h-4v-2h-2v-2h-2v4H6z" fill="#000" />
        </>
      )}
    </svg>
  );
}

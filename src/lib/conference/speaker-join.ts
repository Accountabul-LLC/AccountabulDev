export function speakerJoinPath(requestId: string, token: string) {
  return `/speakers/join?request=${encodeURIComponent(requestId)}#${encodeURIComponent(token)}`;
}

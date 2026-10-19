const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i;

export function resolveLendersListUrl(
  raw: string | undefined,
  allowLocalHttp = false,
): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.startsWith("https://")) return value;
  if (allowLocalHttp && LOCAL_HTTP.test(value)) return value;
  return null;
}

export function lendersListUrl(): string | null {
  return resolveLendersListUrl(
    import.meta.env["VITE_LENDERS_LIST_URL"],
    Boolean(import.meta.env.DEV),
  );
}

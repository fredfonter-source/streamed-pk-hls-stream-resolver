import { userAgent } from "../config/site.js";

export function httpHeaders(referer?: string, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    ...extra,
  };
  if (referer) headers.Referer = referer;
  return headers;
}

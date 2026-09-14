import { Readable } from "node:stream";

import { relayLink } from "./media.js";
import { pull, pullGoatSegmentStream } from "./pull.js";
import { unwrapGoatSegment } from "./unwrap.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
} as const;

function absUri(uri: string, base: string): string {
  return uri.startsWith("http") ? uri : new URL(uri, base).href;
}

function isPlaylist(body: Buffer): boolean {
  return body.toString("utf8", 0, Math.min(body.length, 256)).includes("#EXTM3U");
}

function rewrite(text: string, base: string, referer: string, origin: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        if (!trimmed.includes('URI="')) return line;
        return trimmed.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${relayLink(origin, absUri(uri, base), referer)}"`);
      }
      return relayLink(origin, absUri(trimmed, base), referer);
    })
    .join("\n");
}

function isGoatWebpUrl(target: string): boolean {
  try {
    return new URL(target).hostname.includes("sleepercdn.com");
  } catch {
    return false;
  }
}

export async function proxyHls(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  const referer = url.searchParams.get("referer");
  if (!target || !referer) return new Response("url and referer required", { status: 400, headers: cors });

  try {
    if (target.includes(".m3u8")) {
      const raw = await pull(target, referer);
      if (!raw.length) throw new Error("empty upstream body");
      return new Response(rewrite(raw.toString("utf8"), target, referer, url.origin), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl" },
      });
    }

    if (isGoatWebpUrl(target)) {
      const { stream, contentLength } = await pullGoatSegmentStream(target, referer, request.signal);
      return new Response(Readable.toWeb(stream) as import("node:stream/web").ReadableStream, {
        status: 200,
        headers: {
          ...cors,
          "Content-Type": "video/mp2t",
          "Content-Length": String(contentLength),
        },
      });
    }

    const raw = await pull(target, referer);
    if (!raw.length) throw new Error("empty upstream body");
    if (isPlaylist(raw)) {
      return new Response(rewrite(raw.toString("utf8"), target, referer, url.origin), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl" },
      });
    }
    const segment = unwrapGoatSegment(raw);
    return new Response(new Uint8Array(segment), {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "video/mp2t",
        "Content-Length": String(segment.length),
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 502, headers: cors });
  }
}

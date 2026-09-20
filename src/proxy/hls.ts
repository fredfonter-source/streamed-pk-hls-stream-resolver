import { Readable } from "node:stream";

import { relayLink } from "./media.js";
import { pull, pullGoatSegmentStream } from "./pull.js";
import { unwrapGoatSegment } from "./unwrap.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range, Referer",
  "Access-Control-Expose-Headers": "Content-Length, Content-Type, Content-Range",
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
      // Strip upstream GOAT comments — some strict HLS parsers choke on them
      if (trimmed.startsWith("##")) return null;
      if (trimmed.startsWith("#")) {
        if (!trimmed.includes('URI="')) return line;
        return trimmed.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${relayLink(origin, absUri(uri, base), referer)}"`);
      }
      return relayLink(origin, absUri(trimmed, base), referer);
    })
    .filter((line): line is string => line !== null)
    .join("\n");
}

function isGoatWebpUrl(target: string): boolean {
  try {
    return new URL(target).hostname.includes("sleepercdn.com");
  } catch {
    return false;
  }
}

function detectSegmentContentType(target: string, body?: Buffer): string {
  if (target.includes(".ts")) return "video/mp2t";
  if (target.includes(".mp4") || target.includes(".m4s")) return "video/mp4";
  if (target.includes(".aac")) return "audio/aac";
  if (target.includes(".vtt")) return "text/vtt";
  // Check magic bytes if body available
  if (body && body.length >= 4) {
    if (body[0] === 0x47) return "video/mp2t"; // TS sync byte
    if (body.toString("ascii", 0, 4) === "RIFF") return "video/mp2t"; // WEBP wrapped TS
    if (body.toString("ascii", 0, 4) === "ftyp") return "video/mp4"; // MP4 ftyp box
  }
  return "video/mp2t";
}

export async function proxyHls(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  const referer = url.searchParams.get("referer");
  if (!target || !referer) return new Response("url and referer required", { status: 400, headers: cors });

  const isHead = request.method === "HEAD";

  try {
    if (target.includes(".m3u8")) {
      if (isHead) {
        return new Response(null, {
          status: 200,
          headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache, no-store, must-revalidate" },
        });
      }
      const raw = await pull(target, referer);
      if (!raw.length) throw new Error("empty upstream body");
      return new Response(rewrite(raw.toString("utf8"), target, referer, url.origin), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache, no-store, must-revalidate" },
      });
    }

    if (isGoatWebpUrl(target)) {
      if (isHead) {
        return new Response(null, {
          status: 200,
          headers: { ...cors, "Content-Type": "video/mp2t" },
        });
      }
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

    if (isHead) {
      return new Response(null, {
        status: 200,
        headers: { ...cors, "Content-Type": detectSegmentContentType(target) },
      });
    }

    const raw = await pull(target, referer);
    if (!raw.length) throw new Error("empty upstream body");
    if (isPlaylist(raw)) {
      return new Response(rewrite(raw.toString("utf8"), target, referer, url.origin), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache, no-store, must-revalidate" },
      });
    }
    const segment = unwrapGoatSegment(raw);
    const ct = detectSegmentContentType(target, segment);
    return new Response(new Uint8Array(segment), {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": ct,
        "Content-Length": String(segment.length),
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 502, headers: cors });
  }
}

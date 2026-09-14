import { spawn } from "node:child_process";
import { Readable } from "node:stream";

import { userAgent } from "../config/site.js";

function curlArgs(url: string, referer: string): string[] {
  const origin = new URL(referer).origin;
  return [
    "-sS",
    "-L",
    "-f",
    "-N",
    "--compressed",
    "-A",
    userAgent,
    "-H",
    `Referer: ${referer}`,
    "-H",
    `Origin: ${origin}`,
    "-H",
    "Accept: */*",
    url,
  ];
}

export async function pull(url: string, referer: string): Promise<Buffer> {
  const child = spawn("curl", curlArgs(url, referer), { stdio: ["ignore", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`curl ${code}: ${Buffer.concat(errChunks).toString("utf8").trim() || "failed"}`));
    });
  });
  return Buffer.concat(chunks);
}

export function pullGoatSegmentStream(
  url: string,
  referer: string,
  signal?: AbortSignal,
): Promise<{ stream: Readable; contentLength: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", curlArgs(url, referer), { stdio: ["ignore", "pipe", "pipe"] });
    const errChunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
    child.on("error", reject);

    let pending = Buffer.alloc(0);
    let settled = false;
    let finished = false;
    let out: Readable | null = null;

    const stop = () => {
      if (!child.killed) child.kill("SIGTERM");
    };

    const fail = (error: Error) => {
      if (finished) return;
      stop();
      if (settled) {
        out?.destroy(error);
        return;
      }
      settled = true;
      reject(error);
    };

    if (signal) {
      if (signal.aborted) {
        fail(new Error("aborted"));
        return;
      }
      signal.addEventListener("abort", () => fail(new Error("aborted")), { once: true });
    }

    const onData = (chunk: Buffer) => {
      if (settled) return;
      pending = Buffer.concat([pending, chunk]);
      const meta = readExifTsMeta(pending);
      if (!meta) {
        if (pending.length > 16384) fail(new Error("goat segment header not found"));
        return;
      }

      settled = true;
      child.stdout.off("data", onData);
      out = new Readable({
        read() {},
        destroy(_err, cb) {
          stop();
          cb(null);
        },
      });

      const available = pending.subarray(meta.offset);
      const first = available.subarray(0, Math.min(available.length, meta.length));
      let left = meta.length - first.length;
      out.push(first);

      if (left <= 0) {
        finished = true;
        stop();
        out.push(null);
        resolve({ stream: out, contentLength: meta.length });
        return;
      }

      const onMore = (more: Buffer) => {
        if (!out || left <= 0) return;
        const take = more.subarray(0, left);
        left -= take.length;
        out.push(take);
        if (left <= 0) {
          finished = true;
          child.stdout.off("data", onMore);
          stop();
          out.push(null);
        }
      };
      child.stdout.on("data", onMore);
      resolve({ stream: out, contentLength: meta.length });
    };

    child.stdout.on("data", onData);
    child.on("close", (code) => {
      if (finished || code === 0 || code === null) return;
      fail(new Error(`curl ${code}: ${Buffer.concat(errChunks).toString("utf8").trim() || "failed"}`));
    });
  });
}

function readExifTsMeta(buf: Buffer): { offset: number; length: number } | null {
  if (buf.length < 20 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const tag = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (tag === "EXIF" || tag === "exif") {
      const length = Math.floor(size / 188) * 188;
      return length > 0 ? { offset: data, length } : null;
    }
    const next = data + size + (size & 1);
    if (next > buf.length) return null;
    offset = next;
  }
  return null;
}

export function unwrapGoatSegment(buf: Buffer): Buffer {
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const tag = buf.toString("ascii", offset, offset + 4);
      const size = buf.readUInt32LE(offset + 4);
      const data = offset + 8;
      if (data > buf.length) break;
      if (tag === "EXIF" || tag === "exif") {
        return trimTs(buf.subarray(data, Math.min(data + size, buf.length)));
      }
      offset = data + size + (size & 1);
    }
  }
  if (buf[0] === 0x47) return trimTs(buf);
  const scanned = findTs(buf);
  return scanned < 0 ? buf : trimTs(buf.subarray(scanned));
}

function findTs(buf: Buffer): number {
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (buf[i] !== 0x47) continue;
    let ok = true;
    for (let k = 1; k < 6; k++) {
      const pos = i + k * 188;
      if (pos >= buf.length || buf[pos] !== 0x47) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function trimTs(buf: Buffer): Buffer {
  let start = 0;
  if (buf[0] !== 0x47) {
    start = findTs(buf);
    if (start < 0) return buf;
  }
  const body = start ? buf.subarray(start) : buf;
  const length = Math.floor(body.length / 188) * 188;
  return length === body.length ? body : body.subarray(0, length);
}

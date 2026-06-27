import { pull } from '../wire/curl.js'
import { parseRelaySlot, relayLink } from './link.js'
import { segmentBody } from './segment.js'

const cors = { 'Access-Control-Allow-Origin': '*' }

function absUri(uri, base) {
  return uri.startsWith('http') ? uri : new URL(uri, base).href
}

function isPlaylist(body) {
  const head = body.toString('utf8', 0, Math.min(body.length, 256))
  return head.includes('#EXTM3U')
}

function rewrite(text, base, slot, origin) {
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim()
      if (!t) return line
      if (t.startsWith('#')) {
        if (!t.includes('URI="')) return line
        return t.replace(/URI="([^"]+)"/g, (_, uri) => {
          const href = absUri(uri, base)
          return `URI="${relayLink(origin, href, slot)}"`
        })
      }
      return relayLink(origin, absUri(t, base), slot)
    })
    .join('\n')
}

async function relay(res, url, slot, origin) {
  const raw = await pull(url, slot)

  if (isPlaylist(raw)) {
    res.writeHead(200, {
      ...cors,
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache',
    })
    res.end(rewrite(raw.toString('utf8'), url, slot, origin))
    return
  }

  res.writeHead(200, { ...cors, 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache' })
  res.end(segmentBody(raw))
}

export async function serve(res, params, origin) {
  const target = params.get('url')
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('url required')
    return
  }

  let slot
  try {
    slot = parseRelaySlot(params)
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end(String(err.message || err))
    return
  }

  try {
    await relay(res, target, slot, origin)
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end(String(err.message || err))
    }
  }
}

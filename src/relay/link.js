export function relayLink(base, target, slot) {
  const q = new URLSearchParams({ url: target, embed: slot.path, embedOrigin: slot.origin })
  if (slot.referer) q.set('referer', slot.referer)
  return `${base}/api/hls?${q}`
}

export function parseRelaySlot(params) {
  const path = params.get('embed')
  const origin = params.get('embedOrigin')
  if (!path || !origin) throw new Error('embed and embedOrigin required')
  const parts = path.split('/')
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('invalid embed path')
  const slot = { origin, path }
  const referer = params.get('referer')
  if (referer) slot.referer = referer
  return slot
}

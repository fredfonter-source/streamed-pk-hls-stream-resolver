import { streamedOrigin, ua } from '../env.js'

export async function fetchJson(path) {
  const res = await fetch(`${streamedOrigin}${path}`, {
    headers: { 'User-Agent': ua, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`streamed.pk ${path} ${res.status}`)
  return res.json()
}

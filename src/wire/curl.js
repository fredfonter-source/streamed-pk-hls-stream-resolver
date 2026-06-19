import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ua } from '../env.js'

const exec = promisify(execFile)

function hdrs(slot) {
  return {
    Referer: `${slot.origin}/`,
    Origin: slot.origin,
    'User-Agent': ua,
    Accept: '*/*',
  }
}

function curlArgs(url, headers) {
  const args = ['-sS', '-L', '--compressed']
  for (const [key, value] of Object.entries(headers)) args.push('-H', `${key}: ${value}`)
  args.push(url)
  return args
}

export async function pull(url, slot) {
  const headers = hdrs(slot)
  const args = curlArgs(url, headers)
  args.push('-o', '-', '-w', 'HTTPSTATUS:%{http_code}')
  const { stdout } = await exec('curl', args, { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' })
  const mark = stdout.lastIndexOf(Buffer.from('HTTPSTATUS:'))
  if (mark < 0) throw new Error('curl response parse failed')
  const body = stdout.subarray(0, mark)
  const code = Number(stdout.subarray(mark + 11).toString('utf8'))
  if (code < 200 || code >= 300) throw new Error(`upstream ${code}`)
  return body
}

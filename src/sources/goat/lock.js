import { Worker } from 'node:worker_threads'

const workerUrl = new URL('./lock-worker.js', import.meta.url)

export function unlock(slot, goat, body) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, {
      workerData: { slot, goat, bodyHex: body.toString('hex') },
    })
    worker.once('message', (msg) => {
      worker.terminate().catch(() => {})
      if (msg.ok) resolve(msg.url)
      else reject(new Error(msg.error || 'lock decrypt failed'))
    })
    worker.once('error', (err) => {
      worker.terminate().catch(() => {})
      reject(err)
    })
  })
}

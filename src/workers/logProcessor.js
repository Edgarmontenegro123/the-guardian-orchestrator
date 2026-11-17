import crypto from 'node:crypto'
import {parentPort, workerData} from 'node:worker_threads'
import {HEAVY_TASK_ITERATIONS} from '../config/constants.js'

const sharedView = new Int32Array(workerData.sharedBuffer)

const executeHeavyComputation = (logId) => {
    let hash = String(logId)
    for (let i = 0; i < HEAVY_TASK_ITERATIONS; i++) {
        hash = crypto.createHash('sha256').update(hash).digest('hex')
    }
    return hash.substring(0, 16)
}

parentPort.on('message', (task) => {
    const {requestId, logId} = task

    try {
        const signature = executeHeavyComputation(logId)
        const currentCount = Atomics.add(sharedView, 0, 1) + 1

        parentPort.postMessage({
            requestId,
            status: 'processed',
            logId,
            signature,
            workerProcessedCount: currentCount
        })
    } catch (error) {
        parentPort.postMessage({
            requestId,
            status: 'error',
            error: error.message
        })
    }
})
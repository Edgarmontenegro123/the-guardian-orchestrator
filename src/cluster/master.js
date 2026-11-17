import cluster from 'node:cluster'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {SHUTDOWN_TIMEOUT, WORKER_RESTART_DELAY} from '../config/constants.js'
import {writeLog} from '../utils/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let totalIngestedLogs = 0
let isMasterShuttingDown = false

const broadcastGlobalCount = () => {
    for (const worker of Object.values(cluster.workers)) {
        if (worker && worker.isConnected()) {
            worker.send({type: 'GLOBAL_COUNT_SYNC', total: totalIngestedLogs})
        }
    }
}

const attachWorkerListeners = (worker) => {
    worker.on('message', (msg) => {
        if (msg?.type === 'LOG_INGESTED') {
            totalIngestedLogs += 1
            broadcastGlobalCount()
        }
    })
}

export const runMaster = () => {
    const totalCPUs = os.cpus().length
    const targetWorkers = Math.max(1, Math.floor(totalCPUs / 2))

    void writeLog('info', `[MASTER] Orchestrating ${targetWorkers} workers (${totalCPUs} CPUs available)`)

    cluster.setupPrimary({
        exec: path.join(__dirname, '../workers/clusterWorker.js')
    })

    for (let i = 0; i < targetWorkers; i++) {
        const worker = cluster.fork()
        attachWorkerListeners(worker)
    }

    const rollingRestart = () => {
        void writeLog('info', '[MASTER] Initiating rolling restart via IPC...')
        const workers = Object.values(cluster.workers)

        const restartNext = (index) => {
            if (index >= workers.length) {
                void writeLog('info', '[MASTER] Rolling restart completed successfully')
                return
            }

            const worker = workers[index]
            if (!worker) {
                restartNext(index + 1)
                return
            }

            void writeLog('info', `[MASTER] Sending shutdown signal to worker PID: ${worker.process.pid}`)
            worker.send('shutdown')

            worker.once('exit', () => {
                if (!isMasterShuttingDown) {
                    const replacement = cluster.fork()
                    attachWorkerListeners(replacement)
                    replacement.once('listening', () => {
                        replacement.send({type: 'GLOBAL_COUNT_SYNC', total: totalIngestedLogs})
                    })
                }
                setTimeout(() => restartNext(index + 1), WORKER_RESTART_DELAY)
            })
        }

        restartNext(0)
    }

    const gracefulClusterShutdown = (signal) => {
        if (isMasterShuttingDown) return
        isMasterShuttingDown = true

        void writeLog('warn', `[MASTER] Received ${signal}. Shutting down all workers gracefully...`)

        const workers = Object.values(cluster.workers)
        for (const worker of workers) {
            if (worker && worker.isConnected()) {
                worker.send('shutdown')
            }
        }

        setTimeout(() => {
            void writeLog('error', '[MASTER] Forced cluster exit after safety timeout')
            process.exit(0)
        }, SHUTDOWN_TIMEOUT).unref()
    }

    process.on('SIGUSR2', () => {
        void writeLog('info', '[MASTER] Received SIGUSR2 signal')
        rollingRestart()
    })

    process.on('SIGTERM', () => gracefulClusterShutdown('SIGTERM'))
    process.on('SIGINT', () => gracefulClusterShutdown('SIGINT'))

    cluster.on('exit', (worker, code, signal) => {
        void writeLog('warn', `[MASTER] Worker PID: ${worker.process.pid} exited | Code: ${code} | Signal: ${signal}`)

        if (!isMasterShuttingDown && code !== 0) {
            void writeLog('info', '[MASTER] Self-healing triggered: spawning replacement worker...')
            const replacement = cluster.fork()
            attachWorkerListeners(replacement)
            replacement.once('listening', () => {
                replacement.send({type: 'GLOBAL_COUNT_SYNC', total: totalIngestedLogs})
            })
        }
    })
}
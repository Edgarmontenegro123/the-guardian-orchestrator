import crypto from 'node:crypto'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Worker} from 'node:worker_threads'
import {SHARED_BUFFER_BYTES, SHUTDOWN_TIMEOUT} from '../config/constants.js'
import {createHttpServer} from '../server/httpServer.js'
import {writeLog} from '../utils/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let isShuttingDown = false
let globalClusterCount = 0

// Crea un bloque de memoria RAM de 4 bytes
const sharedBuffer = new SharedArrayBuffer(SHARED_BUFFER_BYTES)
// Crea una vista estructurada de ese búfer para manejar números enteros
const sharedView = new Int32Array(sharedBuffer)
// Un mapa para registrar las promesas pendientes
const pendingTasks = new Map()

const workerThreadPath = path.join(__dirname, 'logProcessor.js')
// Lanza el hilo independiente (logProcessor.js) en otro núcleo de la CPU y le pasa el sharedBuffer a través de workerData
const processorThread = new Worker(workerThreadPath, {
    workerData: {sharedBuffer}
})

processorThread.on('message', (response) => {
    const {requestId, status, error, ...payload} = response
    const taskHandler = pendingTasks.get(requestId)

    if (!taskHandler) return
    pendingTasks.delete(requestId)

    if (status === 'error') {
        taskHandler.reject(new Error(error))
        return
    }

    if (process.send) {
        process.send({type: 'LOG_INGESTED'})
    }

    taskHandler.resolve(payload)
})

processorThread.on('error', async (error) => {
    await writeLog('error', `Worker thread error: ${error.message}`)
})

/*  Cuando entra una petición /ingest, crea un ID único, guarda la promesa en el mapa,
    y le envía la tarea al hilo hijo con processorThread.postMessage */
const delegateIngestTask = (logId) => {
    return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID()
        pendingTasks.set(requestId, {resolve, reject})
        processorThread.postMessage({requestId, logId})
    })
}

const server = createHttpServer({
    onIngest: delegateIngestTask,
    getStatus: () => ({
        isShuttingDown,
        // garantiza una lectura segura y directa desde la RAM compartida sin riesgos de race conditions.
        localCount: Atomics.load(sharedView, 0),
        globalCount: globalClusterCount
    })
})

process.on('message', async (msg) => {
    if (msg?.type === 'GLOBAL_COUNT_SYNC') {
        globalClusterCount = msg.total
        return
    }

    if (msg === 'shutdown') {
        isShuttingDown = true
        await writeLog('warn', 'Shutdown signal received via IPC. Closing HTTP server gracefully...')

        const forceTimeout = setTimeout(async () => {
            await writeLog('error', 'Safety timeout reached. Forcing worker exit.')
            await processorThread.terminate()
            process.exit(0)
        }, SHUTDOWN_TIMEOUT)

        server.close(async () => {
            clearTimeout(forceTimeout)
            await processorThread.terminate()
            await writeLog('info', 'HTTP server and worker thread closed cleanly. Exiting with code 0.')
            process.exit(0)
        })
    }
})
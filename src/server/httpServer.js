import http from 'node:http'
import {URL} from 'node:url'
import {PORT} from '../config/constants.js'
import {writeLog} from '../utils/logger.js'

export const createHttpServer = ({onIngest, getStatus}) => {
    const server = http.createServer(async (req, res) => {
        const parsedUrl = new URL(req.url, 'http://localhost')
        const pathname = parsedUrl.pathname

        // Si llega una petición GET a /health, responde de forma inmediata con el estado ok y el PID del worker que atendió la petición.
        if (pathname === '/health' && req.method === 'GET') {
            res.writeHead(200, {'Content-Type': 'application/json'})
            res.end(JSON.stringify({
                status: 'ok',
                pid: process.pid
            }))
            return
        }

        if (pathname === '/ingest' && req.method === 'GET') {
            const {isShuttingDown} = getStatus()
            if (isShuttingDown) {
                res.writeHead(503, {'Content-Type': 'application/json'})
                res.end(JSON.stringify({error: 'Worker is shutting down'}))
                return
            }

            const rawId = parsedUrl.searchParams.get('id')
            const logId = Number(rawId)

            if (!rawId || Number.isNaN(logId)) {
                res.writeHead(400, {'Content-Type': 'application/json'})
                res.end(JSON.stringify({error: 'Invalid or missing numeric id query parameter'}))
                return
            }

            try {
                const result = await onIngest(logId)
                res.writeHead(200, {'Content-Type': 'application/json'})
                res.end(JSON.stringify({
                    status: 'ingested',
                    pid: process.pid,
                    ...result
                }))
            } catch (error) {
                await writeLog('error', `Failed to ingest log ${logId}: ${error.message}`)
                res.writeHead(500, {'Content-Type': 'application/json'})
                res.end(JSON.stringify({error: 'Failed to process log'}))
            }
            return
        }

        if (pathname === '/metrics' && req.method === 'GET') {
            const {localCount, globalCount} = getStatus()
            res.writeHead(200, {'Content-Type': 'application/json'})
            res.end(JSON.stringify({
                pid: process.pid,
                workerSharedMemoryCount: localCount,
                clusterGlobalCount: globalCount
            }))
            return
        }

        res.writeHead(404, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({error: 'Not found'}))
    })

    server.listen(PORT, () => {
        void writeLog('info', `HTTP Server listening on port ${PORT}`)
    })

    return server
}
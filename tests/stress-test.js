const BASE_URL = 'http://127.0.0.1:8085'
const TOTAL_INGEST_REQUESTS = 500
const CONCURRENCY_LIMIT = 50
const CONCURRENT_HEALTH_CHECKS = 25

const measureHealthCheck = async (index) => {
    const start = performance.now()
    const response = await fetch(`${BASE_URL}/health`, {headers: {Connection: 'close'}})
    const data = await response.json()
    const latencyMs = Number((performance.now() - start).toFixed(2))
    return {index, status: response.status, latencyMs, pid: data.pid}
}

const sendIngestRequest = async (id) => {
    const response = await fetch(`${BASE_URL}/ingest?id=${id}`, {headers: {Connection: 'close'}})
    return response.status
}

const runIngestPool = async () => {
    const statuses = []
    let nextIndex = 0

    const worker = async () => {
        while (nextIndex < TOTAL_INGEST_REQUESTS) {
            const currentId = 1000 + nextIndex
            nextIndex += 1
            const status = await sendIngestRequest(currentId)
            statuses.push(status)
        }
    }

    const pool = Array.from({length: CONCURRENCY_LIMIT}, () => worker())
    await Promise.all(pool)
    return statuses
}

const runStressTest = async () => {
    console.log(`Starting concurrent test: ${TOTAL_INGEST_REQUESTS} /ingest (${CONCURRENCY_LIMIT} concurrent) + ${CONCURRENT_HEALTH_CHECKS} /health...`)

    const initialMetricsRes = await fetch(`${BASE_URL}/metrics`)
    const initialMetrics = await initialMetricsRes.json()
    const initialCount = initialMetrics.clusterGlobalCount

    const healthPromises = Array.from({length: CONCURRENT_HEALTH_CHECKS}, (_, i) =>
        new Promise((resolve) => setTimeout(resolve, i * 10)).then(() => measureHealthCheck(i + 1))
    )

    const allIngests = runIngestPool()
    const allHealths = Promise.all(healthPromises)

    const ingestStatuses = await allIngests
    const healthResults = await allHealths

    const finalMetricsRes = await fetch(`${BASE_URL}/metrics`)
    const finalMetrics = await finalMetricsRes.json()
    const processedDelta = finalMetrics.clusterGlobalCount - initialCount

    const successfulIngests = ingestStatuses.filter((status) => status === 200).length
    const latencies = healthResults.map((h) => h.latencyMs)
    const avgLatency = (latencies.reduce((acc, val) => acc + val, 0) / latencies.length).toFixed(2)
    const maxLatency = Math.max(...latencies).toFixed(2)

    console.log('\n--- HEALTH CHECK LATENCY REPORT (DURING HEAVY LOAD) ---')
    console.log(`Total /health probes: ${healthResults.length}`)
    console.log(`Average latency: ${avgLatency} ms | Max latency: ${maxLatency} ms`)

    console.log('\n--- SHARED MEMORY & ATOMICS INTEGRITY REPORT ---')
    console.log(`HTTP 200 /ingest responses: ${successfulIngests}/${TOTAL_INGEST_REQUESTS}`)
    console.log(`Global atomic counter delta: ${processedDelta} (Expected: ${TOTAL_INGEST_REQUESTS})`)
    console.log(`Data drift: ${TOTAL_INGEST_REQUESTS - processedDelta}`)
}

void runStressTest()
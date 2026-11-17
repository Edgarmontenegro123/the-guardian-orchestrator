import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const logFilePath = path.join(__dirname, '../../app.log')

export const writeLog = async (level, message) => {
    const now = new Date()
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 19)
    const formattedLevel = level.toUpperCase()
    const logEntry = `[${timestamp}] [${formattedLevel}] [PID: ${process.pid}] ${message}\n`

    console.log(logEntry.trim())

    try {
        await fs.appendFile(logFilePath, logEntry, 'utf8')
    } catch (error) {
        console.error(`[LOGGER ERROR] Failed to write log: ${error.message}`)
    }
}
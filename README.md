# The Guardian — Concurrent Log Ingestion & Resilience Orchestrator

Sistema distribuido, concurrente y tolerante a fallos desarrollado en **Node.js (ESM)** puro (`node:cluster`, `node:worker_threads`, `node:http`, `SharedArrayBuffer`, `Atomics`), contenedorizado sobre **Alpine Linux** sin privilegios de `root`.

## Arquitectura del Sistema

1. **Orquestador Master (`src/cluster/master.js`)**:
    - Escala horizontalmente levantando la mitad de los núcleos lógicos disponibles (`Math.max(1, Math.floor(os.cpus().length / 2))`).
    - Supervisa la salud de los procesos hijos (*Self-Healing* automático ante cierres inesperados con código distinto de `0`).
    - Coordina **Rolling Restarts** sin caída de servicio ante la señal POSIX `SIGUSR2` mediante comunicación entre procesos (**IPC**).
    - Mantiene el estado global acumulado del clúster (`clusterGlobalCount`).

2. **Workers HTTP (`src/workers/clusterWorker.js` + `src/server/httpServer.js`)**:
    - Cada proceso hijo levanta un servidor HTTP no bloqueante en el puerto `8080` con los endpoints:
        - `GET /health`: Diagnóstico de disponibilidad y PID del worker que responde.
        - `GET /ingest?id=X`: Recepción de paquetes y delegación de cómputo intensivo sin bloquear el Event Loop.
        - `GET /metrics`: Consulta de métricas locales (memoria compartida del worker) y globales (clúster).

3. **Paralelismo CPU y Memoria Compartida (`src/workers/logProcessor.js`)**:
    - Cada worker delega el hashing criptográfico intensivo (**SHA-256 iterativo**) a un `worker_thread` dedicado.
    - Sincroniza los contadores locales sobre un `SharedArrayBuffer` mediante `Atomics.add` y `Atomics.load`, eliminando condiciones de carrera (*0 data drift*).

4. **Persistencia Asíncrona (`src/utils/logger.js`)**:
    - Registro estructurado en salida estándar (`stdout`) y archivo (`app.log`) usando `fs.promises.appendFile` sin bloquear el Event Loop.

## Ejecución con Docker

```bash
# 1. Construir la imagen optimizada
docker build -t guardian-redes:v1 .

# 2. Levantar el contenedor (puerto 8080 interno expuesto en puerto libre del host)
docker run -d -p 8085:8080 --name guardian-container guardian-redes:v1

# 3. Inspeccionar árbol de procesos (PID 1 Master + Workers bajo usuario node)
docker exec -it guardian-container ps aux

# 4. Disparar Rolling Restart sin caída de servicio (SIGUSR2)
docker exec guardian-container kill -USR2 1
```

## Pruebas de Concurrencia y Latencia

```bash
node tests/stress-test.js
```
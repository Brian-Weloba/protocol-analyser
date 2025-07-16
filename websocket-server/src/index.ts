import { Elysia } from 'elysia';
import  prometheus  from 'elysia-prometheus';
import { Gauge, Histogram } from 'prom-client';

// --- Prometheus Metrics ---
const connections = new Gauge({
    name: 'ws_active_connections',
    help: 'Number of active WebSocket connections.',
});
const latency = new Histogram({
    name: 'ws_action_latency_seconds',
    help: 'Latency for processing a WebSocket action.',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
});

const app = new Elysia()
    .use(prometheus()) // Exposes /metrics endpoint
    .ws('/ws', {
        open(ws) {
            connections.inc();
            console.log(`[WS] Client connected: ${ws.id}`);
        },
        message(ws, message) {
            const endTimer = latency.startTimer();
            const parsed = JSON.parse(message as string);
            if (parsed.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: parsed.timestamp }));
            }
            endTimer();
        },
        close(ws) {
            connections.dec();
            console.log(`[WS] Client disconnected: ${ws.id}`);
        },
    })
    .listen(3000);

console.log(`[WS] WebSocket server running at port 3000`);
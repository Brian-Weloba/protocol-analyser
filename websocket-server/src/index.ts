// websocket-server/src/index.ts

import { Elysia } from 'elysia';
import { Registry, Gauge, Histogram, Counter, collectDefaultMetrics } from 'prom-client';

// --- Prometheus Metrics Setup ---
// This registry will hold all our metrics.
const registry = new Registry();

// Add default metrics (CPU, memory, etc.) to our custom registry
collectDefaultMetrics({ register: registry });

// =============================================================================
// == Primary Metrics
// =============================================================================

// 1. Action Latency (RTT) - with percentiles
const latency = new Histogram({
    name: 'ws_action_latency_seconds',
    help: 'Round-trip time from client to server and back.',
    registers: [registry],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1], // Buckets in seconds
});

// 2. Reconnections
const reconnectionSuccessTotal = new Counter({
    name: 'ws_reconnection_success_total',
    help: 'Total number of successful reconnections.',
    registers: [registry],
});

// 3. Packet Loss (simulated by tracking unacknowledged pings)
const packetLossTotal = new Counter({
    name: 'ws_packet_loss_total',
    help: 'Total number of packets considered lost (e.g., unacknowledged pings).',
    registers: [registry],
});

// 4. State Synchronization
const stateDesyncTotal = new Counter({
    name: 'ws_state_desync_total',
    help: 'Total number of detected state desynchronization events.',
    registers: [registry],
});

// 5. Connection Establishment Time
const connectionEstablishmentDuration = new Histogram({
    name: 'ws_connection_establishment_duration_seconds',
    help: 'Time taken for a new client to establish a stable connection.',
    registers: [registry],
    buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5], // Buckets in seconds
});


// =============================================================================
// == Secondary Metrics
// =============================================================================

// 1. Bandwidth / Data Transfer
const bytesReceivedTotal = new Counter({
    name: 'ws_bytes_received_total',
    help: 'Total bytes received from clients.',
    registers: [registry],
});

const bytesSentTotal = new Counter({
    name: 'ws_bytes_sent_total',
    help: 'Total bytes sent to clients.',
    registers: [registry],
});

// 2. Error Rates
const wsErrorsTotal = new Counter({
    name: 'ws_errors_total',
    help: 'Total number of WebSocket errors, categorized by type.',
    labelNames: ['type'],
    registers: [registry],
});

// 3. Active Connections
const connections = new Gauge({
    name: 'ws_active_connections',
    help: 'Number of active WebSocket connections.',
    registers: [registry]
});


// =============================================================================
// == Elysia Application Setup
// =============================================================================

const app = new Elysia()
    .ws('/ws', {
        // Store connection time on the WebSocket instance's data property
        open(ws) {
            (ws.data as any).connectedAt = Date.now(); // Store connection timestamp
            connections.inc(); // Increment active connections gauge
            console.log(`[WS] Client connected: ${ws.id}`);
        },
        
        message(ws, message) {
            // Track bytes received
            if (typeof message === 'string') {
                bytesReceivedTotal.inc(Buffer.byteLength(message, 'utf8'));
            } else if (message instanceof ArrayBuffer) {
                bytesReceivedTotal.inc(message.byteLength);
            }

            try {
                const parsed = JSON.parse(message as string);

                // Handle different message types from the client
                switch(parsed.type) {
                    case 'ping':
                        const endTimer = latency.startTimer(); // Start latency timer
                        const response = JSON.stringify({ type: 'pong', timestamp: parsed.timestamp });
                        ws.send(response);
                        bytesSentTotal.inc(Buffer.byteLength(response, 'utf8'));
                        endTimer(); // End latency timer and record observation
                        break;
                    
                    case 'init_ack':
                        // Client confirms connection, so we can record establishment time
                        const establishmentTime = (Date.now() - (ws.data as any).connectedAt) / 1000;
                        connectionEstablishmentDuration.observe(establishmentTime);
                        break;
                    
                    case 'reconnected':
                        // Client reports a successful reconnection
                        reconnectionSuccessTotal.inc();
                        break;
                    
                    // Add other application-specific logic here
                }
            } catch (error) {
                wsErrorsTotal.inc({ type: 'message_parse_error' });
                console.error("Failed to parse message:", message, error);
            }
        },
        
        close(ws) {
            connections.dec(); // Decrement active connections gauge
            console.log(`[WS] Client disconnected: ${ws.id}`);
        }
    })

    // KEY CHANGE: Create a manual endpoint to expose all metrics from our registry
    .get('/metrics', async ({ set }) => {
        // Set the correct content type for Prometheus
        set.headers['Content-Type'] = registry.contentType;
        // Return the metrics scraped from the registry
        return await registry.metrics();
    })

    .listen(3000);

console.log(`🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`);
console.log(`📈 Metrics available at http://${app.server?.hostname}:${app.server?.port}/metrics`);
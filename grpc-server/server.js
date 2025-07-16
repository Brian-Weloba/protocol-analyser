const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const promClient = require('prom-client');
const http = require('http');

const PROTO_PATH = './proto/game.proto';

const connections = new promClient.Gauge({ name: 'grpc_active_streams', help: 'Number of active gRPC streams.' });
const latency = new promClient.Histogram({ name: 'grpc_action_latency_seconds', help: 'Latency for processing a gRPC action.', buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1] });

const packageDefinition = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
const gameProto = grpc.loadPackageDefinition(packageDefinition).game;

function gameChat(call) {
    connections.inc();
    console.log('[gRPC] Client connected to GameChat stream.');
    call.on('data', function (message) {
        const endTimer = latency.startTimer();
        call.write({ timestamp: message.timestamp, payload: `Server received: ${message.payload}` });
        endTimer();
    });
    call.on('end', function () { connections.dec(); console.log('[gRPC] Client disconnected from GameChat stream.'); call.end(); });
    call.on('error', function (err) { connections.dec(); console.error('[gRPC] Stream error:', err.message); });
}

const metricsServer = http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
        res.setHeader('Content-Type', promClient.register.contentType);
        return res.end(await promClient.register.metrics());
    }
    res.writeHead(404).end();
});
metricsServer.listen(9091, () => console.log('[Metrics] Metrics server running on port 9091'));

function main() {
    const server = new grpc.Server();
    server.addService(gameProto.GameService.service, { gameChat: gameChat });
    server.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), () => {
        server.start();
        console.log('[gRPC] gRPC server running on port 50051');
    });
}

main();
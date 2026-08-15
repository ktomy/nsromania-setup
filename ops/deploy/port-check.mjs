#!/usr/bin/env node

import net from 'node:net';

const [host, portValue] = process.argv.slice(2);
const port = Number(portValue);

if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
    console.error(`Usage: ${process.argv[1]} HOST PORT`);
    process.exit(2);
}

const socket = net.createConnection({ host, port });
socket.setTimeout(5_000);

socket.on('connect', () => {
    console.log(`Listening: ${host}:${port}`);
    socket.end();
});
socket.on('timeout', () => socket.destroy(new Error('connection timed out')));
socket.on('error', (error) => {
    console.error(`Port check failed for ${host}:${port}: ${error.message}`);
    process.exit(1);
});

#!/usr/bin/env node

import http from 'node:http';
import https from 'node:https';

const [urlValue, expectedCommit] = process.argv.slice(2);

if (!urlValue || !/^[0-9a-f]{40}$/.test(expectedCommit || '')) {
    console.error(`Usage: ${process.argv[1]} URL COMMIT_SHA`);
    process.exit(2);
}

const request = (url) =>
    new Promise((resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http;
        const request = client.get(
            url,
            {
                headers: {
                    Accept: 'application/json',
                    'Cache-Control': 'no-cache',
                },
                timeout: 5_000,
            },
            (response) => {
                const chunks = [];
                let length = 0;

                response.on('data', (chunk) => {
                    length += chunk.length;
                    if (length > 16_384) {
                        request.destroy(new Error('health response exceeds 16 KiB'));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () =>
                    resolve({
                        statusCode: response.statusCode,
                        body: Buffer.concat(chunks).toString('utf8'),
                    })
                );
            }
        );

        request.on('timeout', () => request.destroy(new Error('health request timed out')));
        request.on('error', reject);
    });

try {
    const url = new URL(urlValue);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('health URL must use HTTP or HTTPS');
    }

    const response = await request(url);
    if (response.statusCode !== 200) {
        throw new Error(`health endpoint returned HTTP ${response.statusCode}`);
    }

    const payload = JSON.parse(response.body);
    if (payload?.status !== 'ok' || payload?.commit !== expectedCommit) {
        throw new Error(`health endpoint did not report commit ${expectedCommit}`);
    }

    console.log(`Healthy: ${url.href} (${expectedCommit})`);
} catch (error) {
    console.error(`Health check failed for ${urlValue}: ${error.message}`);
    process.exit(1);
}

import fs from 'fs';
import path from 'path';

const messagesDir = path.join(process.cwd(), 'messages');

export function watchMessages() {
    fs.watch(messagesDir, { recursive: true }, () => {
        console.log('Messages changed. Clearing cache...');
        Object.keys(require.cache).forEach((key) => {
            if (key.includes('/messages/')) {
                delete require.cache[key];
            }
        });
    });
}

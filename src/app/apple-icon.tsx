import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// iOS/Safari home-screen icon, rendered at build time from the SVG favicon.
export default async function AppleIcon() {
    const svg = await readFile(path.join(process.cwd(), 'src/app/icon.svg'));
    const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;

    // Full-bleed square: iOS applies its own rounded mask and shows transparent corners as black.
    return new ImageResponse(
        <div style={{ display: 'flex', width: '100%', height: '100%', background: '#1976d2' }}>
            <img src={src} width={size.width} height={size.height} alt="" />
        </div>,
        size
    );
}

import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Link preview image used by Facebook, WhatsApp, X, LinkedIn, etc. Rendered once at build time.
export const alt = 'NSRomânia — Nightscout';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const CHART = { width: 440, height: 300, min: 40, max: 300, low: 70, high: 180 };

// A made-up but plausible day of CGM readings, drawn as Nightscout-style dots.
const readings = Array.from({ length: 40 }, (_, i) => 135 + 55 * Math.sin(i / 5.5) + 18 * Math.sin(i / 1.9 + 1));

const y = (mgdl: number) => CHART.height - ((mgdl - CHART.min) / (CHART.max - CHART.min)) * CHART.height;
const x = (i: number) => 20 + (i / (readings.length - 1)) * (CHART.width - 40);

export default async function OpenGraphImage() {
    const fontDir = path.join(process.cwd(), 'node_modules/@fontsource/roboto/files');
    const [bold, regular, icon] = await Promise.all([
        readFile(path.join(fontDir, 'roboto-latin-700-normal.woff')),
        readFile(path.join(fontDir, 'roboto-latin-400-normal.woff')),
        readFile(path.join(process.cwd(), 'src/app/icon.svg')),
    ]);
    const iconSrc = `data:image/svg+xml;base64,${icon.toString('base64')}`;

    return new ImageResponse(
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 80px',
                background: 'linear-gradient(135deg, #0d47a1 0%, #1976d2 55%, #42a5f5 100%)',
                color: '#ffffff',
                fontFamily: 'Roboto',
            }}
        >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                <img src={iconSrc} width={112} height={112} alt="" style={{ borderRadius: 24 }} />
                <div style={{ fontSize: 96, fontWeight: 700, marginTop: 36, letterSpacing: -2 }}>NSRomânia</div>
                <div style={{ fontSize: 44, opacity: 0.9, marginTop: 4 }}>Nightscout</div>
                <div style={{ fontSize: 30, opacity: 0.75, marginTop: 48 }}>nsromania.info</div>
            </div>
            <div
                style={{
                    display: 'flex',
                    padding: 24,
                    borderRadius: 32,
                    background: 'rgba(255, 255, 255, 0.12)',
                }}
            >
                <svg width={CHART.width} height={CHART.height} viewBox={`0 0 ${CHART.width} ${CHART.height}`}>
                    <rect
                        x={0}
                        y={y(CHART.high)}
                        width={CHART.width}
                        height={y(CHART.low) - y(CHART.high)}
                        rx={12}
                        fill="#66bb6a"
                        fillOpacity={0.35}
                    />
                    {readings.map((mgdl, i) => (
                        <circle key={i} cx={x(i)} cy={y(mgdl)} r={7} fill="#ffffff" />
                    ))}
                </svg>
            </div>
        </div>,
        {
            ...size,
            fonts: [
                { name: 'Roboto', data: bold, weight: 700, style: 'normal' },
                { name: 'Roboto', data: regular, weight: 400, style: 'normal' },
            ],
        }
    );
}

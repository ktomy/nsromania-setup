import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */

const nextConfig = {
    output: 'standalone',
    serverExternalPackages: ['pm2'],
    eslint: {
        dirs: ['./src/app', './src/lib/components'],
    },
};

export default withNextIntl(nextConfig);

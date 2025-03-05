import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */

const nextConfig = {
    eslint: {
        dirs: ['./src/app', "./src/lib/components"],
    },
    webpack: (config, { isServer }) => {
        if (isServer) {
            // Exclude `pm2` from the Webpack bundle
            config.externals.push('pm2');
        }
        return config;
    },
};

export default withNextIntl(nextConfig);

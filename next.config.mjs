/** @type {import('next').NextConfig} */

const nextConfig = {
    webpack: (config, { isServer }) => {
        if (isServer) {
            // Exclude `pm2` from the Webpack bundle
            config.externals.push('pm2');
        }
        return config;
    },
};
export default nextConfig;

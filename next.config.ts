import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  webpack(config) {
    // Next compiles worker dependencies in both graphs. Always choose the browser backend.
    config.resolve.alias['taglib-wasm$'] = require.resolve('taglib-wasm').replace(/index\.js$/, 'index.browser.js');
    // TagLib's Emscripten loader has an unreachable Node branch in browsers.
    config.resolve.fallback = { ...config.resolve.fallback, module: false };
    return config;
  },
};
export default nextConfig;

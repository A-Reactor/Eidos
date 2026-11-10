import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {},
  webpack(config, { dev }) {
    if (dev) {
      // Voice runtimes and model caches contain thousands of files unrelated to HMR.
      const ignored = config.watchOptions?.ignored;
      const voiceFiles = /[\\/](?:\.venv-voice|\.momoi-training)(?:[\\/]|$)/;
      config.watchOptions = { ...config.watchOptions,
        ignored: ignored instanceof RegExp ? new RegExp(`${ignored.source}|${voiceFiles.source}`) : voiceFiles };
    }
    return config;
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // transpilePackages pulls @dialeros/control-plane's raw TS through
  // Next's compiler for both server + client targets. control-plane
  // imports node:net / node:os / node:sqlite for ESL + pacing; on
  // the client target webpack 5 raises UnhandledSchemeError on the
  // node: URI prefix during module resolution. We never actually
  // call those from a client component (no 'use client' file
  // imports @dialeros/control-plane), but transpilePackages doesn't
  // tree-shake at the URI level — the imports are still in the
  // dependency graph when webpack tries to resolve them.
  transpilePackages: ['@dialeros/control-plane'],
  webpack: (config, { isServer, nextRuntime }) => {
    // For the Node.js server runtime, leave control-plane alone —
    // it really does need crypto / fs / net / sqlite at runtime.
    // For client + edge runtimes, the imports are dead code (no
    // edge / client component invokes anything from control-plane)
    // but they're in the dependency graph because transpilePackages
    // pulls the whole barrel through Next's compiler.
    const isNodeServer = isServer && nextRuntime === 'nodejs';
    if (!isNodeServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        crypto: false,
        fs: false,
        net: false,
        os: false,
        path: false,
        events: false,
        sqlite: false,
        'fs/promises': false,
        module: false,
      };
    }
    return config;
  },
};

export default nextConfig;

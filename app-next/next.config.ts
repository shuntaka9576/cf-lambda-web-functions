import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // .next/standalone に server.js と必要な node_modules だけを出力する
  output: 'standalone',
  // 親ディレクトリにも bun.lock があるため、ルートを固定しないと
  // standalone の出力が .next/standalone/app-next/ にずれる
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
};

export default nextConfig;

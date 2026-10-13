import type { NextConfig } from 'next';
import { EXPIRE_SECONDS } from './isr-config';

const nextConfig: NextConfig = {
  // .next/standalone に server.js と必要な node_modules だけを出力する
  output: 'standalone',
  // 親ディレクトリにも bun.lock があるため、ルートを固定しないと
  // standalone の出力が .next/standalone/app-next/ にずれる
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  // 既定の 1 年だと、アクセスが途切れたあとにいくらでも古い内容を stale として返す。
  // expire を過ぎた entry は Next.js がその場で描画し直し、
  // Cache-Control の stale-while-revalidate も (expireTime - revalidate) 秒になる
  expireTime: EXPIRE_SECONDS,
};

export default nextConfig;

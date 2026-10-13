import { NextResponse } from 'next/server';

// ISR のキャッシュヒットも含め、オリジンへのリクエストごとに通る
export function proxy() {
  const envId = process.env.POC_ENV_ID ?? 'unknown';
  const originAt = new Date().toISOString();
  const response = NextResponse.next();
  response.headers.set('x-poc-env-id', envId);
  response.headers.set('x-poc-origin-at', originAt);
  // ブラウザの JS から読めるレスポンスヘッダーは Server-Timing だけなので、
  // オリジンがリクエストを受けた時刻と実行環境をここにも載せる。
  // CloudFront はキャッシュから返すときに Server-Timing を落とすので、
  // CloudFront 経由では viewer-response の CloudFront Functions が x-poc-* から組み立て直す
  response.headers.set('Server-Timing', `origin;desc="${originAt}", env;desc="${envId}"`);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

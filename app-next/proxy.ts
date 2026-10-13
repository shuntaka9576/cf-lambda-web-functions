import { NextResponse } from 'next/server';

// ISR のキャッシュヒットも含め、どの実行環境が応答したかをレスポンスヘッダーで返す
export function proxy() {
  const response = NextResponse.next();
  response.headers.set('x-poc-env-id', process.env.POC_ENV_ID ?? 'unknown');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

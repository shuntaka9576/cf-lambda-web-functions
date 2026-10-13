import { revalidatePath } from 'next/cache';
import type { NextRequest } from 'next/server';

// revalidatePath がリクエストを受けた環境にしか効かないことを確かめる。
// 検証用なので認証は付けていない。検証が終わったらスタックごと消す
export async function POST(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('path');
  if (!target?.startsWith('/')) {
    return Response.json({ error: 'path query is required' }, { status: 400 });
  }
  revalidatePath(target);
  return Response.json({ revalidated: target, envId: process.env.POC_ENV_ID ?? null });
}

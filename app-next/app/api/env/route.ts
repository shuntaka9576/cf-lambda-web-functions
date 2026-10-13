import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export const dynamic = 'force-dynamic';

// 書き込めるかを試し、書けなければ EROFS などのエラーコードを返す
async function probeWrite(dir: string) {
  const file = path.join(dir, `.probe-${randomUUID()}`);
  try {
    await writeFile(file, 'probe');
    await rm(file);
    return { dir, ok: true };
  } catch (error) {
    return { dir, ok: false, code: (error as NodeJS.ErrnoException).code ?? String(error) };
  }
}

export async function GET() {
  // standalone の server.js は自身のディレクトリに chdir するので、cwd は /var/task になる
  const distDir = path.join(process.cwd(), '.next');
  return Response.json({
    envId: process.env.POC_ENV_ID ?? null,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    region: process.env.AWS_REGION ?? null,
    cwd: process.cwd(),
    writable: await Promise.all([probeWrite(distDir), probeWrite(os.tmpdir())]),
  });
}

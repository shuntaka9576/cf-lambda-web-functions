import { createHash } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

const app = new Hono();

app.get('/', (c) =>
  c.json({
    message: 'Hello from Lambda Web Functions',
    region: process.env.AWS_REGION ?? null,
    requestId: c.req.header('lambda-web-request-id') ?? null,
  }),
);

// CloudFront (OAC) 経由の POST で body がそのまま届くかを確認する。
// クライアントは x-amz-content-sha256 を付けずに送る想定
app.post('/echo', async (c) => {
  const body = Buffer.from(await c.req.arrayBuffer());
  return c.json({
    bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    contentType: c.req.header('content-type') ?? null,
  });
});

// viewer の Authorization ヘッダーが関数まで届くかを確認する
app.get('/headers', (c) => c.json(c.req.header()));

// レスポンスストリーミングを確認する
app.get('/stream', (c) =>
  streamSSE(c, async (stream) => {
    for (let i = 0; i < 5; i++) {
      await stream.writeSSE({ data: JSON.stringify({ i, time: new Date().toISOString() }) });
      await stream.sleep(1000);
    }
  }),
);

// Lambda が AWS_LAMBDA_HTTP_ENDPOINT (host:port) で待ち受け先を渡す。未設定はローカル実行時のみ
const [hostname, port] = (process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? 'localhost:3000').split(':');
serve({ fetch: app.fetch, hostname, port: Number(port) }, (info) => {
  console.log(`listening on ${info.address}:${info.port}`);
});

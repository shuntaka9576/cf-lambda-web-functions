// CPU バウンドなリクエストが、同じ実行環境のほかのリクエストを待たせるかを確かめる。
// イベントループが止まる影響だけを見たいので、フレームワークを挟まず node:http だけで書く
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { availableParallelism } from 'node:os';

// 実行環境ごとの ID。プロセスは実行環境ごとに 1 つなので、起動時に作った ID で環境を見分けられる
const envId = randomUUID();

const server = createServer((req, res) => {
  const receivedAt = new Date().toISOString();
  const url = new URL(req.url, 'http://localhost');
  // CloudFront は /node/* をこの関数に回す。ローカルでは接頭辞なしでも呼べるようにする
  const route = url.pathname.replace(/^\/node(?=\/|$)/, '');
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (route === '/ping') {
    return send(200, { envId, receivedAt });
  }
  if (route === '/info') {
    return send(200, { envId, availableParallelism: availableParallelism() });
  }
  if (route === '/cpu') {
    // 自分で書いた計算の代わりに、指定した時間だけループで CPU を回す。
    // 組み込みの非同期 API と違って逃がし先がないので、回している間はイベントループが止まる
    const ms = Math.min(Math.max(Number(url.searchParams.get('ms')) || 100, 1), 5000);
    const startedAt = performance.now();
    let loops = 0;
    while (performance.now() - startedAt < ms) loops++;
    return send(200, {
      envId,
      receivedAt,
      finishedAt: new Date().toISOString(),
      ms: Math.round(performance.now() - startedAt),
      loops,
    });
  }
  send(404, { error: 'not found' });
});

// Lambda が AWS_LAMBDA_HTTP_ENDPOINT (host:port) で待ち受け先を渡す。未設定はローカル実行時のみ
const address = process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? 'localhost:3000';
const separator = address.lastIndexOf(':');
server.listen(Number(address.slice(separator + 1)), address.slice(0, separator), () => {
  console.log(`listening on ${address} (envId=${envId})`);
});

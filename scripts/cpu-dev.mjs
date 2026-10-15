// CPU 検証の画面をローカルで開くための起動スクリプト。
// CloudFront と同じく / は画面、/node/* は Node.js、/go/* は Go に振り分けるプロキシを立てる
//   node scripts/cpu-dev.mjs  →  http://localhost:3100
import { execFileSync, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { request, createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const node = { host: '127.0.0.1', port: 3101 };
const go = { host: '127.0.0.1', port: 3102 };

// go run は子プロセスでサーバーを動かし、止めても残ってしまうので、ビルドしてから直接起動する
execFileSync('go', ['build', '-o', 'target/server-dev', '.'], { cwd: `${root}/app-cpu-go`, stdio: 'inherit' });

const children = [
  spawn('node', ['app-cpu-node/index.mjs'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, AWS_LAMBDA_HTTP_ENDPOINT: `${node.host}:${node.port}` },
  }),
  // Web Functions の実行環境は 2 vCPU なので、Go のスケジューラーも 2 本にそろえる
  spawn(`${root}/app-cpu-go/target/server-dev`, [], {
    stdio: 'inherit',
    env: { ...process.env, AWS_LAMBDA_HTTP_ENDPOINT: `${go.host}:${go.port}`, GOMAXPROCS: '2' },
  }),
];
const stop = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

createServer(async (req, res) => {
  if (req.url === '/') {
    // 本番では S3 から配る画面。編集しながら見られるよう、毎回ファイルから読む
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(await readFile(`${root}/app-cpu-ui/index.html`));
  }
  const upstream = req.url.startsWith('/go/') ? go : node;
  const proxied = request({ ...upstream, path: req.url, method: req.method, headers: req.headers }, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  proxied.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  });
  req.pipe(proxied);
}).listen(3100, () => console.log('open http://localhost:3100'));

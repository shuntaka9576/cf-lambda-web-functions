// Web Functions のエントリ。ランタイムは Node.js しか無いので、同梱した Rust のサーバーを子プロセスで起動する。
// AWS_LAMBDA_HTTP_ENDPOINT は環境変数ごと子に引き継がれ、待ち受けは Rust 側が行う
const { spawn } = require('node:child_process');
const path = require('node:path');

const server = spawn(path.join(__dirname, 'server'), { stdio: 'inherit' });

// Lambda は環境を消す前に SIGTERM を送ってくるので子に転送する
process.on('SIGTERM', () => server.kill('SIGTERM'));

// 子が落ちたら Node も終了させ、Lambda に環境を作り直させる
server.on('exit', (code, signal) => {
  console.log(`server exited (code=${code}, signal=${signal})`);
  process.exit(code ?? 1);
});
server.on('error', (err) => {
  console.error(err);
  process.exit(1);
});

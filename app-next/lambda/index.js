// Web Functions のエントリ。standalone の server.js と同じディレクトリに置く
const { randomUUID } = require('node:crypto');

// Lambda は待ち受け先を AWS_LAMBDA_HTTP_ENDPOINT (host:port) で渡すが、
// standalone の server.js は HOSTNAME と PORT を読むので変換する。未設定はローカル実行時のみ
const address = process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? 'localhost:3000';
const separator = address.lastIndexOf(':');
process.env.HOSTNAME = address.slice(0, separator);
process.env.PORT = address.slice(separator + 1);

// 実行環境ごとの ID。どの環境がページを再生成し、どの環境が応答したかを見分けるのに使う
process.env.POC_ENV_ID = randomUUID();

require('./server.js');

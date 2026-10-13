'use client';

import { useEffect, useState } from 'react';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
// サーバーとブラウザの時計のずれや通信時間を吸収するための余裕
const TOLERANCE_SECONDS = 1;

// 2026-10-14T07:35:59.997+09:00 の形にする。Date.parse でそのまま読める
function toJst(ms: number) {
  return new Date(ms + JST_OFFSET_MS).toISOString().replace('Z', '+09:00');
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} 秒`;
}

type Props = {
  // 描画を始めた時刻と終えた時刻（ISO 形式）
  renderedAt: string;
  finishedAt: string;
  renderedBy: string;
  revalidate: number;
  expire: number;
  // 描画にかかる時間（わざと遅くしているページだけ）
  renderSeconds?: number;
};

type Received = {
  // オリジンがリクエストを受けた時刻と実行環境（proxy.ts が Server-Timing に載せる）
  originAt?: number;
  originEnv?: string;
  // ブラウザが最初のバイトを受け取った時刻
  receivedAt: number;
};

function readReceived(): Received {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const get = (name: string) => nav?.serverTiming.find((entry) => entry.name === name)?.description;
  const origin = get('origin');
  return {
    originAt: origin ? Date.parse(origin) : undefined,
    originEnv: get('env'),
    receivedAt: performance.timeOrigin + (nav?.responseStart ?? 0),
  };
}

export function RenderInfo(props: Props) {
  const { renderedBy, revalidate, expire, renderSeconds } = props;
  const renderedAt = Date.parse(props.renderedAt);
  const finishedAt = Date.parse(props.finishedAt);

  // サーバーとブラウザで値が違うと hydration エラーになるので、マウント後に入れる
  const [received, setReceived] = useState<Received | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setReceived(readReceived());
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <h2>設定</h2>
      <table>
        <tbody>
          <tr>
            <th>revalidate</th>
            <td>{revalidate} 秒（これを過ぎると古いとみなし、裏で再生成する）</td>
          </tr>
          <tr>
            <th>expireTime</th>
            <td>{expire} 秒（これを過ぎた内容は返さず、その場で描画し直す）</td>
          </tr>
          <tr>
            <th>オリジンが返す Cache-Control</th>
            <td>
              <code>
                s-maxage={revalidate}, stale-while-revalidate={expire - revalidate}
              </code>
            </td>
          </tr>
          <tr>
            <th>CloudFront</th>
            <td>TTL はオリジンの Cache-Control に従う（min 0 / default 0 / max 365 日）</td>
          </tr>
          {renderSeconds !== undefined && (
            <tr>
              <th>描画にかかる時間</th>
              <td>{renderSeconds} 秒</td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>この応答の経路</h2>
      <table>
        <thead>
          <tr>
            <th />
            <th>時刻</th>
            <th>実行環境</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>描画</th>
            <td id="rendered-at">{toJst(renderedAt)}</td>
            <td id="rendered-by">{renderedBy}</td>
          </tr>
          <tr>
            <th>オリジンが受けた</th>
            <td>{received?.originAt ? toJst(received.originAt) : '-'}</td>
            <td>{received?.originEnv ?? '-'}</td>
          </tr>
          <tr>
            <th>ブラウザが受け取った</th>
            <td>{received ? toJst(received.receivedAt) : '-'}</td>
            <td />
          </tr>
        </tbody>
      </table>
      {received && <Explanation {...{ renderedAt, finishedAt, revalidate, expire, received }} />}

      <h2>今</h2>
      <p>
        {now ? toJst(now) : '-'}
        {now && ` （描画から ${seconds(now - renderedAt)}）`}
      </p>
    </>
  );
}

function Explanation({
  renderedAt,
  finishedAt,
  revalidate,
  expire,
  received,
}: {
  renderedAt: number;
  finishedAt: number;
  revalidate: number;
  expire: number;
  received: Received;
}) {
  if (received.originAt === undefined) {
    return <p>Server-Timing ヘッダーが取れなかったので、経路を判定できません。</p>;
  }
  const { originAt, receivedAt } = received;

  // オリジンがリクエストを受けた時点で、キャッシュが描画から何秒経っていたか
  const originAgeSeconds = (originAt - renderedAt) / 1000;
  const renderedOnTheSpot = originAgeSeconds < TOLERANCE_SECONDS;
  // その場で描画したなら描画を終えた時刻、キャッシュを返したなら受けた時刻が、オリジンの応答時刻
  const respondedAt = renderedOnTheSpot ? Math.max(originAt, finishedAt) : originAt;
  // 描画を始めてからオリジンが応答するまで（キャッシュされていた時間、またはその場で描画した時間）
  const originSideSeconds = (respondedAt - renderedAt) / 1000;
  // オリジンが応答してから、ブラウザが受け取るまでの時間（CloudFront にキャッシュされていた時間）
  const cdnAgeSeconds = (receivedAt - respondedAt) / 1000;
  const totalSeconds = (receivedAt - renderedAt) / 1000;

  const origin = renderedOnTheSpot
    ? 'オリジンは、このリクエストのためにその場で描画しました（キャッシュが無かったか、expireTime を過ぎていた）。'
    : originAgeSeconds <= revalidate
      ? `オリジンは、${originAgeSeconds.toFixed(1)} 秒前に描画したキャッシュを返しました（revalidate ${revalidate} 秒以内なので HIT）。`
      : originAgeSeconds <= expire
        ? `オリジンは、${originAgeSeconds.toFixed(1)} 秒前に描画した期限切れのキャッシュを返し、裏で再生成を始めました（revalidate ${revalidate} 秒を過ぎ、expireTime ${expire} 秒以内なので STALE）。`
        : `オリジンは、expireTime ${expire} 秒を過ぎたキャッシュを返しました（想定外）。`;

  const cdn =
    cdnAgeSeconds < TOLERANCE_SECONDS
      ? 'CloudFront は、このリクエストのためにオリジンへ取りに行きました（または CloudFront を通っていません）。'
      : cdnAgeSeconds <= revalidate
        ? `CloudFront は、${cdnAgeSeconds.toFixed(1)} 秒前にオリジンから取得したキャッシュを返しました（s-maxage ${revalidate} 秒以内）。`
        : cdnAgeSeconds <= expire
          ? `CloudFront は、${cdnAgeSeconds.toFixed(1)} 秒前に取得した期限切れのキャッシュを返し、裏でオリジンに取り直しています（s-maxage を過ぎ、stale-while-revalidate の範囲内）。`
          : `CloudFront は、${cdnAgeSeconds.toFixed(1)} 秒前に取得したキャッシュを返しました（想定外）。`;

  return (
    <ol>
      <li>{origin}</li>
      <li>{cdn}</li>
      <li>
        受け取った時点で、内容は描画から <strong>{totalSeconds.toFixed(1)} 秒</strong>
        経っていました（オリジン側 {Math.max(0, originSideSeconds).toFixed(1)} 秒 + CloudFront 側{' '}
        {Math.max(0, cdnAgeSeconds).toFixed(1)} 秒）。
      </li>
    </ol>
  );
}

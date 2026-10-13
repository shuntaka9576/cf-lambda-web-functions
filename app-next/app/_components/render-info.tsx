'use client';

import { useEffect, useState } from 'react';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 2026-10-14T07:35:59.997+09:00 の形にする。Date.parse でそのまま読める
function toJst(date: Date) {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().replace('Z', '+09:00');
}

// サーバーで描画した時刻と、ブラウザの今の時刻を並べて表示する。
// 差が revalidate を超えていれば、キャッシュされた古い内容を見ていると分かる
export function RenderInfo({ renderedAt, renderedBy }: { renderedAt: string; renderedBy: string }) {
  // サーバーとブラウザで時刻が違うと hydration エラーになるので、マウント後に入れる
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const rendered = new Date(renderedAt);
  const ageSeconds = now ? Math.floor((now.getTime() - rendered.getTime()) / 1000) : null;

  return (
    <dl>
      <dt>renderedAt（サーバーで描画した時刻）</dt>
      <dd id="rendered-at">{toJst(rendered)}</dd>
      <dt>now（ブラウザの今の時刻）</dt>
      <dd id="now">{now ? toJst(now) : '-'}</dd>
      <dt>age（描画からの経過秒数）</dt>
      <dd id="age">{ageSeconds ?? '-'}</dd>
      <dt>renderedBy（描画した実行環境）</dt>
      <dd id="rendered-by">{renderedBy}</dd>
    </dl>
  );
}

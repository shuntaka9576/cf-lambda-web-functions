import { setTimeout } from 'node:timers/promises';
import { RenderInfo } from '../_components/render-info';

// 描画に 5 秒かかる ISR ページ。STALE を返したあと、処理中のリクエストが無い間も
// 裏の再生成が最後まで走るか（実行環境が CPU を止めないか）を確かめる
export const revalidate = 10;

export default async function IsrSlowPage() {
  const renderedAt = new Date().toISOString();
  await setTimeout(5000);
  return (
    <main>
      <h1>/isr-slow</h1>
      <RenderInfo renderedAt={renderedAt} renderedBy={process.env.POC_ENV_ID ?? 'build'} />
    </main>
  );
}

import { setTimeout } from 'node:timers/promises';
import { EXPIRE_SECONDS } from '../../isr-config';
import { RenderInfo } from '../_components/render-info';

// 描画に 5 秒かかる ISR ページ。STALE を返したあと、処理中のリクエストが無い間も
// 裏の再生成が最後まで走るか（実行環境が CPU を止めないか）を確かめる
export const revalidate = 10;

const RENDER_SECONDS = 5;

export default async function IsrSlowPage() {
  const renderedAt = new Date().toISOString();
  await setTimeout(RENDER_SECONDS * 1000);
  return (
    <main>
      <h1>/isr-slow</h1>
      <RenderInfo
        renderedAt={renderedAt}
        finishedAt={new Date().toISOString()}
        renderedBy={process.env.POC_ENV_ID ?? 'build'}
        revalidate={revalidate}
        expire={EXPIRE_SECONDS}
        renderSeconds={RENDER_SECONDS}
      />
    </main>
  );
}

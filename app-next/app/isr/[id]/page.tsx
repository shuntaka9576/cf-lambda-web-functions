import { EXPIRE_SECONDS } from '../../../isr-config';
import { RenderInfo } from '../../_components/render-info';

// 10 秒ごとの時間ベース ISR。CloudFront 経由で受け取る内容が何秒古くなるかを測る
export const revalidate = 10;

// 検証には /isr/1 だけを使う。それ以外は 404 にする
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ id: '1' }];
}

export default async function IsrItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const renderedAt = new Date().toISOString();
  return (
    <main>
      <h1>/isr/{id}</h1>
      <RenderInfo
        renderedAt={renderedAt}
        finishedAt={new Date().toISOString()}
        renderedBy={process.env.POC_ENV_ID ?? 'build'}
        revalidate={revalidate}
        expire={EXPIRE_SECONDS}
      />
    </main>
  );
}

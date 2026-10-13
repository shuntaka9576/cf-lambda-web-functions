import { RenderInfo } from '../_components/render-info';

// 10 秒ごとの時間ベース ISR。renderedBy でどの実行環境が再生成したかを見る。
// ビルド時の事前生成では POC_ENV_ID が無いので "build" になる
export const revalidate = 10;

export default function IsrPage() {
  return (
    <main>
      <h1>/isr</h1>
      <RenderInfo
        renderedAt={new Date().toISOString()}
        renderedBy={process.env.POC_ENV_ID ?? 'build'}
      />
    </main>
  );
}

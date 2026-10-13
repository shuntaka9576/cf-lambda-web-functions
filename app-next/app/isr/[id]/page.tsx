import { RenderInfo } from '../../_components/render-info';

export const revalidate = 10;

// 1 と 2 だけビルド時に生成する。それ以外は初回リクエストを受けた環境で生成される
export const dynamicParams = true;

export function generateStaticParams() {
  return [{ id: '1' }, { id: '2' }];
}

export default async function IsrItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main>
      <h1>/isr/{id}</h1>
      <RenderInfo
        renderedAt={new Date().toISOString()}
        renderedBy={process.env.POC_ENV_ID ?? 'build'}
      />
    </main>
  );
}

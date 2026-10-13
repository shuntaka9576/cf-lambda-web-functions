import type { ReactNode } from 'react';

export const metadata = { title: 'Next.js ISR on Lambda Web Functions' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

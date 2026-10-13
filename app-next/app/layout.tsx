import type { ReactNode } from 'react';

export const metadata = { title: 'Next.js ISR on Lambda Web Functions' };

const css = `
body { font-family: system-ui, sans-serif; margin: 24px; line-height: 1.6; }
table { border-collapse: collapse; margin-bottom: 8px; }
th, td { border: 1px solid #ccc; padding: 4px 10px; text-align: left; }
th { background: #f5f5f5; font-weight: 600; }
code { font-size: 0.95em; }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <style>{css}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}

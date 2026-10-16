import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "法人税申告書AIアシスタント",
  description: "決算データから法人税申告書のドラフトを作成し、税務調整と不備の確認を支援します。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}

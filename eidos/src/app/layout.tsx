import type { Metadata, Viewport } from "next";
import { EidosShell } from "@/components/shell/EidosShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eidos — AI 驱动的世界引擎",
  description: "输入任意行动，输出连贯叙事、状态变化和因果预测",
};

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      data-theme="light"
      data-motion="full"
      className="antialiased"
    >
      <body className="flex flex-col bg-black text-zinc-200">
        <EidosShell>{children}</EidosShell>
      </body>
    </html>
  );
}

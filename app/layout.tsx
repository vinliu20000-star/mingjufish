import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./login.css";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "mingjufish.local";
  const protocol = h.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return { title: "名桔鮮魚湯｜工時管理", description: "讓出勤核對與薪資試算更輕省的一頁式工時工具。", icons: { icon: "/favicon.svg" }, openGraph: { title: "名桔鮮魚湯｜工時管理", description: "工時核對・薪資試算，一頁清楚完成。", images: [image] }, twitter: { card: "summary_large_image", images: [image] } };
}
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-Hant"><body>{children}</body></html>; }

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.ncmswift.xyz'),
  title: 'NCM Swift — NCM 转 MP3',
  description: '免费在线 NCM 转 MP3，支持批量转换、试听与打包下载。文件仅在浏览器本地处理，无需上传。',
  alternates: { canonical: '/' },
  openGraph: { title: 'NCM Swift — NCM 转 MP3', description: '选择文件，转换，下载。所有音频都在你的设备上处理。', url: '/' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}

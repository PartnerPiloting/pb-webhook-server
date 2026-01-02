import "./globals.css";
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: "🚀 Network Accelerator",
  description: "Score leads — Start conversations — Close deals",
  icons: {
    icon: '/favicon-main.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}

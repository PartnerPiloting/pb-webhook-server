import "./globals.css";

export const metadata = {
  title: "Hotfix - LinkedIn Follow-Up Portal",
  description: "Multi-Tenant Lead Management System",
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

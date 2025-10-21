export const metadata = {
  title: 'Vercel Test',
  description: 'Minimal deployment test',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

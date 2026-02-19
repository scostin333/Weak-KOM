import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Weak KOM',
  description: 'Find your best KOM opportunities using wind data',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        />
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css"
        />
      </head>
      <body className="bg-gray-900 text-white antialiased">{children}</body>
    </html>
  );
}

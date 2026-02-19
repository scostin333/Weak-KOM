import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Weak KOM – Find Your Best Strava KOM Opportunities',
  description:
    'Weak KOM analyses Strava segments near you and ranks KOM opportunities by pace, competition, and wind conditions so you can target the ones you can actually beat.',
  keywords: [
    'Strava KOM',
    'KOM hunter',
    'Strava segments',
    'cycling KOM',
    'weak KOM',
    'Strava opportunities',
    'bike racing segments',
  ],
  metadataBase: new URL('https://weakkom.com'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: 'https://weakkom.com',
    title: 'Weak KOM – Find Your Best Strava KOM Opportunities',
    description:
      'Rank nearby Strava segments by how beatable their KOM is. Uses wind, pace, and competition data to surface your best chances.',
    siteName: 'Weak KOM',
  },
  twitter: {
    card: 'summary',
    title: 'Weak KOM – Find Your Best Strava KOM Opportunities',
    description:
      'Rank nearby Strava segments by how beatable their KOM is. Uses wind, pace, and competition data.',
  },
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

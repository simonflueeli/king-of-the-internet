// OWNER: F. Root layout: fonts and global tokens.
import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk, UnifrakturMaguntia } from "next/font/google";
import "./globals.css";

const blackletter = UnifrakturMaguntia({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-blackletter",
});

const sans = Schibsted_Grotesk({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: "The Throne",
  description: "Put your name on the throne until someone pays at least 10% more.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#121A5C",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${blackletter.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}

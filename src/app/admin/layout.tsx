// OWNER: S. Admin area shell: quiet styling, never indexed.
import type { Metadata } from "next";
import s from "@/components/admin/admin.module.css";

export const metadata: Metadata = {
  title: "Admin · The Throne",
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={s.shell}>{children}</div>;
}

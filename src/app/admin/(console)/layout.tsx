// OWNER: S. Signed-in admin console: requires an admin session on every page.
import Link from "next/link";
import { connection } from "next/server";
import { AdminNav, SignOutButton } from "@/components/admin/client";
import s from "@/components/admin/admin.module.css";
import { requireAdminPage } from "@/server/admin/page";
import { pendingReportCount } from "@/server/moderation/reports";

export default async function AdminConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const admin = await requireAdminPage();
  const pending = await pendingReportCount();
  return (
    <>
      <header className={s.header}>
        <Link href="/admin" className={s.brand}>
          The Throne
        </Link>
        <AdminNav pendingReports={pending} />
        <div className={s.who}>
          <span>{admin.email}</span>
          <SignOutButton />
        </div>
      </header>
      <main className={s.main}>{children}</main>
    </>
  );
}

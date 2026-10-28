// OWNER: S. /admin/login — passkey sign-in (and localhost dev login).
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginPanel } from "@/components/admin/LoginPanel";
import s from "@/components/admin/admin.module.css";
import { currentAdmin, pageDevLoginAllowed } from "@/server/admin/page";

export default async function AdminLoginPage() {
  await connection();
  if (await currentAdmin()) redirect("/admin");
  return (
    <main className={s.login}>
      <LoginPanel devLogin={await pageDevLoginAllowed()} />
    </main>
  );
}

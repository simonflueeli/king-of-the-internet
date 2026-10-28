// OWNER: S. Admin identity for server components under /admin (cookies via next/headers).
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, adminFromToken, devLoginAllowed, type AdminIdentity } from "./auth";

export async function currentAdmin(): Promise<AdminIdentity | null> {
  const jar = await cookies();
  return adminFromToken(jar.get(ADMIN_COOKIE)?.value);
}

/** The signed-in admin, or a redirect to /admin/login. */
export async function requireAdminPage(): Promise<AdminIdentity> {
  const admin = await currentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

export async function pageDevLoginAllowed(): Promise<boolean> {
  return devLoginAllowed((await headers()).get("host"));
}

import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/auth/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminIndexPage() {
  const admin = await isAdminAuthenticated();
  if (admin) {
    redirect("/admin/campaigns");
  }
  redirect("/admin/login");
}

import { redirect } from "next/navigation";
import { getClientContext } from "@/lib/auth/context";
import { getLeadRepository } from "@/lib/integrations/data";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (getClientContext()) redirect("/dashboard");

  const clients = await getLeadRepository().listClients();

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-slate-600">
        Pick a client to view their dashboard. This is a development sign-in
        screen — replace with real auth before production.
      </p>

      {clients.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          No clients in the database. Run <code>npm run db:seed</code>.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {clients.map((c) => (
            <li key={c.id}>
              <form action="/api/auth/sign-in" method="POST">
                <input type="hidden" name="clientId" value={c.id} />
                <button
                  type="submit"
                  className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-left text-sm font-medium text-slate-900 hover:bg-slate-50"
                >
                  Sign in as {c.name}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

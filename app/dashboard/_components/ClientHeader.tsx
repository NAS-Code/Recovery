export function ClientHeader({ clientName }: { clientName: string }) {
  return (
    <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-3 text-xs text-slate-500">
      <span>
        Signed in as <span className="font-medium text-slate-700">{clientName}</span>
      </span>
      <form action="/api/auth/sign-out" method="POST">
        <button type="submit" className="underline hover:text-slate-700">
          Sign out
        </button>
      </form>
    </div>
  );
}

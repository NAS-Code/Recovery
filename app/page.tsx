import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">No-Show Recovery</h1>
      <p className="mt-2 text-slate-600">
        Prototype service for recovering missed event meetings.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-block rounded bg-slate-900 px-4 py-2 text-white"
      >
        Open dashboard
      </Link>
    </main>
  );
}

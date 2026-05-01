import type { ConversationMessage } from "@/lib/core/types";

function formatTimestamp(d: Date): string {
  return d.toLocaleString();
}

export function Thread({ messages }: { messages: ConversationMessage[] }) {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-slate-500">No messages yet.</p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m) => (
        <li
          key={m.id}
          className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-md rounded-lg px-3 py-2 text-sm ${
              m.direction === "outbound"
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-900 ring-1 ring-slate-200"
            }`}
          >
            <p className="whitespace-pre-wrap">{m.text}</p>
            <p
              className={`mt-1 text-[10px] ${
                m.direction === "outbound" ? "text-slate-300" : "text-slate-500"
              }`}
            >
              {m.direction} · {formatTimestamp(m.timestamp)}
            </p>
            {m.claudeClassification ? (
              <details
                className={`mt-2 text-[11px] ${
                  m.direction === "outbound" ? "text-slate-300" : "text-slate-600"
                }`}
              >
                <summary className="cursor-pointer">
                  Classified as {m.claudeClassification.category}
                  {m.claudeClassification.is_confirmation
                    ? " · confirmation"
                    : ""}
                </summary>
                <p className="mt-1">{m.claudeClassification.reasoning}</p>
              </details>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

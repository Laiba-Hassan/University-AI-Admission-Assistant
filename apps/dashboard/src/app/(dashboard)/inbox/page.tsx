"use client";
import { ConversationSplit } from "@/components/ConversationSplit";
import { apiFetch } from "@/lib/api";

export default function InboxPage() {
  return (
    <div>
      <h1 className="font-heading text-[26px] font-semibold text-ink">Inbox</h1>
      <p className="text-sm text-ink-2">Conversations waiting for a staff reply.</p>
      <div className="mt-4">
        <ConversationSplit
          queryString="?status=needs_human"
          emptyLabel="Nothing waiting for a reply right now."
          allowReply
          renderActions={(d, refresh) => (
            <div className="flex items-center gap-2">
              <button
                onClick={() => apiFetch(`/api/v1/conversations/${d.id}/assign`, { method: "POST", body: "{}" }).then(refresh)}
                className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink hover:bg-tint"
              >
                Assign to me
              </button>
              <button
                onClick={() => apiFetch(`/api/v1/conversations/${d.id}/status`, { method: "POST", body: JSON.stringify({ status: "closed" }) }).then(refresh)}
                className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink hover:bg-tint"
              >
                Close
              </button>
            </div>
          )}
        />
      </div>
    </div>
  );
}

"use client";

import { ConversationSplit } from "@/components/ConversationSplit";
export default function InboxPage() {
  return <div>
      <h1 className="font-heading text-[26px] font-semibold text-ink">Inbox</h1>
      <p className="text-sm text-ink-2">Conversations the AI couldn't handle on its own — reply and it goes straight back to the bot.</p>
      <div className="mt-4">
        <ConversationSplit queryString="?status=needs_human" emptyLabel="Nothing waiting for a reply right now." allowReply showHandoffReason />
      </div>
    </div>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, Send, Sparkles, RotateCcw } from "lucide-react";
import { getPartnerMessages, addPartnerMessage, clearPartnerConversation } from "@/lib/db/repo/partner";
import { buildPartnerContext, describePartnerContext } from "@/lib/partner/context";
import { askPartner, type PartnerChatMessage } from "@/lib/partner/askPartner";

const SUGGESTIONS = [
  "What should I eat right now?",
  "What do I need to improve?",
  "How's my week going?",
  "What should I focus on today?",
];

export default function PartnerPage() {
  const router = useRouter();
  const messages = useLiveQuery(() => getPartnerMessages(), []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const greetedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  // Proactive, one-shot greeting the very first time someone opens a conversation with nothing
  // in it yet — a real partner speaks first instead of waiting to be asked something.
  useEffect(() => {
    if (messages == null || messages.length > 0 || greetedRef.current) return;
    greetedRef.current = true;
    // Deferred via setTimeout: this effect fires on mount, at the exact same moment this page's
    // own useLiveQuery (messages, above) — and any other useLiveQuery active elsewhere in the
    // app — is also starting up. sendToPartner ultimately calls addPartnerMessage(), a real Dexie
    // write; un-deferred, that write risked inheriting Dexie's "this code is inside a
    // useLiveQuery querier, read-only" zone tracking and getting rejected with "ReadOnlyError:
    // Readwrite transaction in liveQuery context" — the same class of bug already fixed at every
    // other write-on-mount site (src/lib/auth/AuthProvider.tsx, src/components/AppBootstrap.tsx,
    // src/components/OnboardingGate.tsx, src/lib/sync/engine.ts, src/lib/sync/outbox.ts).
    setTimeout(() => {
      sendToPartner(null);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  async function sendToPartner(userText: string | null) {
    setError(null);
    setPending(true);
    try {
      const history: PartnerChatMessage[] = (messages ?? []).map((m) => ({ role: m.role, content: m.content }));
      if (userText) {
        await addPartnerMessage("user", userText);
        history.push({ role: "user", content: userText });
      }
      const ctx = await buildPartnerContext(new Date());
      const reply = await askPartner({ contextText: describePartnerContext(ctx), history, message: userText });
      await addPartnerMessage("assistant", reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  function handleSend() {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    sendToPartner(text);
  }

  async function handleReset() {
    if (!confirm("Clear this conversation? This can't be undone.")) return;
    await clearPartnerConversation();
    greetedRef.current = false;
  }

  if (!messages) return <div className="p-5 pt-[calc(1.5rem+var(--safe-top))] text-sm text-text-muted">Loading…</div>;

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg/95 px-4 pb-3 pt-[calc(0.75rem+var(--safe-top))] backdrop-blur">
        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium text-text-muted">
          <ChevronLeft size={16} />
          Back
        </button>
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles size={15} className="text-accent" />
          Your Partner
        </div>
        <button onClick={handleReset} aria-label="Reset conversation" className="text-text-faint active:text-text-muted">
          <RotateCcw size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <div key={m.id} className={`flex animate-message-in ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user" ? "bg-accent text-accent-foreground" : "bg-surface-2 text-text"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}

          {pending && (
            <div className="flex animate-message-in justify-start">
              <div className="flex items-center gap-1.5 rounded-2xl bg-surface-2 px-4 py-3.5">
                <span className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-text-faint" style={{ animationDelay: "0ms" }} />
                <span className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-text-faint" style={{ animationDelay: "150ms" }} />
                <span className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-text-faint" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}

          {error && <div className="animate-message-in rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{error}</div>}
        </div>
        <div ref={bottomRef} />
      </div>

      {messages.length <= 1 && !pending && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-5 pb-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => sendToPartner(s)}
              className="shrink-0 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-muted active:brightness-90"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-border bg-bg px-4 py-3 pb-[calc(0.75rem+var(--safe-bottom))]">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            placeholder="Ask your partner anything…"
            className="max-h-32 flex-1 resize-none rounded-2xl border border-border bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || pending}
            aria-label="Send"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-transform active:scale-90 disabled:opacity-40"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

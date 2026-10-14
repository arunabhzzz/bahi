import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { State } from "../../../packages/domain/src/ledger";
import { money } from "../../../packages/contracts/src/money";
import "./style.css";
type Message = { role: "owner" | "bahi"; text: string; tool?: string };
const examples = [
  "Sold 2 kg sugar to Ramesh, he paid 30",
  "Who owes me money?",
  "Why were sales down on Tuesday?",
  "What's running low?",
];
const CONFIRM_WORDS =
  /^\s*(confirm|yes|yes yes|yeah|yep|haan|haa|han|haan ji|ok|okay|theek hai|thik hai|sahi hai|record it|do it|go ahead|sure)[\s.!]*$/i;
import { Quantity } from "./components/LedgerLines";
import { RestockPlanCard } from "./components/RestockPlanCard";
import { ActionPreview } from "./components/ActionPreview";
import { InsightCard } from "./components/InsightCard";
function App() {
  const [token, setToken] = useState(
    sessionStorage.getItem("bahi-token") ?? "",
  );
  const [state, setState] = useState<State | null>(null),
    [context, setContext] = useState<any>({}),
    [messages, setMessages] = useState<Message[]>(() =>
      JSON.parse(sessionStorage.getItem("bahi-chat") ?? "[]"),
    ),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState<
      | { text: string; requestId: string; confirmationOperation?: string }
      | undefined
    >(() => {
      const value = sessionStorage.getItem("bahi-retry");
      return value ? JSON.parse(value) : undefined;
    }),
    [plan, setPlan] = useState<any>(),
    [previous, setPrevious] = useState<any>(),
    [pending, setPending] = useState<any>(),
    [receipt, setReceipt] = useState<any>(),
    [insight, setInsight] = useState<any>(),
    [mode, setMode] = useState(""),
    [mute, setMute] = useState(true),
    [privateScreen, setPrivate] = useState(true),
    [voiceConsent, setConsent] = useState(false),
    [listening, setListening] = useState(false);
  const conversation = useRef<HTMLDivElement>(null);
  const recognizer = useRef<any>(null);
  const recognitionSupported = !!(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );
  const api = async (path: string, data?: any, t = token) => {
    const r = await fetch("/api/" + path, {
      method: data ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const body = await r.json();
    if (!r.ok) throw Error(body.error ?? "Connection failed");
    return body;
  };
  const start = async (seed = true) => {
    setBusy(true);
    setError("");
    try {
      const result = await api("session", { seed }, "");
      sessionStorage.setItem("bahi-token", result.token);
      sessionStorage.removeItem("bahi-chat");
      sessionStorage.removeItem("bahi-retry");
      setRetry(undefined);
      setToken(result.token);
      setMessages([]);
      setPlan(undefined);
      setPending(undefined);
      setReceipt(undefined);
      setInsight(undefined);
      const loaded = await api("state", undefined, result.token);
      setState(loaded.state);
      setContext(loaded.context);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!token) {
      void start();
      return;
    }
    void api("state")
      .then((r) => {
        setState(r.state);
        setContext(r.context);
        setPending(r.context.pending);
        setPlan(r.context.plan);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    sessionStorage.setItem("bahi-chat", JSON.stringify(messages.slice(-20)));
    if (conversation.current)
      conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [messages]);
  const send = async (
    command: string,
    requestId: string = crypto.randomUUID(),
    confirmationOperation?: string,
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setText("");
    setMessages((m) => [...m, { role: "owner", text: command }]);
    const speak = (text: string) => {
      if (!mute && "speechSynthesis" in window) {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-IN";
        speechSynthesis.speak(u);
      }
    };
    try {
      if (CONFIRM_WORDS.test(command) && !confirmationOperation)
        throw Error(
          "No displayed preview. Nothing is waiting for a yes on this screen.",
        );
      const request = { text: command, requestId, confirmationOperation };
      setRetry(request);
      sessionStorage.setItem("bahi-retry", JSON.stringify(request));
      const r = await api("command", request);
      setRetry(undefined);
      sessionStorage.removeItem("bahi-retry");
      setState(r.state);
      setContext(r.context);
      setPending(r.pending);
      // Show only the card for this answer.
      setInsight(r.insight);
      setReceipt(r.receipt);
      setPlan(r.plan);
      setPrevious(r.plan ? r.previous : undefined);
      if (r.mode) setMode(r.mode);
      setMessages((m) => [
        ...m,
        { role: "bahi", text: r.message, tool: (r.tools ?? [r.tool]).join(" → ") },
      ]);
      speak(r.message);
    } catch (e) {
      setError((e as Error).message);
      speak((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mic = async () => {
    if (listening) {
      recognizer.current?.stop();
      setListening(false);
      return;
    }
    if (!voiceConsent) {
      setError(
        "Consent to browser speech processing before using the microphone. Typing always works.",
      );
      return;
    }
    if (!recognitionSupported) {
      setError(
        "Browser speech recognition is unavailable. Use the typed command field.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      const Recognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      const rec = new Recognition();
      rec.lang = "en-IN";
      rec.interimResults = false;
      rec.continuous = false;
      rec.onresult = (e: any) => {
        setText(e.results[0][0].transcript);
        setListening(false);
      };
      rec.onerror = (e: any) => {
        setError(`Microphone/speech error: ${e.error}. Use typed input.`);
        setListening(false);
      };
      rec.onend = () => setListening(false);
      recognizer.current = rec;
      rec.start();
      setListening(true);
    } catch (e) {
      setError("Microphone permission denied or unavailable. Use typed input.");
      setListening(false);
    }
  };
  const reset = () => {
    if (
      window.confirm(
        "Start a fresh demo shop? Your current demo shop is left as it is.",
      )
    )
      void start(true);
  };
  return (
    <>
      <header>
        <a className="brand" href="/">
          bahi<span>बही</span>
        </a>
        <div className="header-note">
          Your shop, in conversation.
          <small>Alexa+ simulation · real ledger · synthetic demo data</small>
        </div>
        <button onClick={reset} disabled={busy}>
          Fresh demo
        </button>
      </header>
      <main>
        <section className="workspace">
          <div className="page-title">
            <div>
              <div className="eyebrow">Talk to your bahi</div>
              <h1>What needs doing?</h1>
            </div>
            <span className="status">
              {busy
                ? "Working through MCP…"
                : listening
                  ? "Listening…"
                  : mode
                    ? `Ready · ${mode}`
                    : "Ready to help"}
            </span>
          </div>
          <p className="intro">
            Record sales and credit by talking. Fix mistakes the same way. Ask
            why business changed.
          </p>
          <div
            className="conversation"
            ref={conversation}
            role="log"
            aria-label="Shop conversation"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <div className="welcome">
                <div className="eyebrow">Start a conversation</div>
                <p>
                  Say it the way you would to a helper. Anything that changes
                  money or stock is read back first and waits for your yes.
                </p>
                <div className="suggestions">
                  {examples.map((e) => (
                    <button key={e} onClick={() => setText(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.slice(-10).map((m, i) => (
                <article key={i} className={"message " + m.role}>
                  <div className="eyebrow">
                    {m.role === "owner" ? "You" : "Bahi"}
                    {m.tool && <span> · MCP {m.tool}</span>}
                  </div>
                  <p>{m.text}</p>
                </article>
              ))
            )}
          </div>
          {retry && (
            <button
              onClick={() =>
                void send(
                  retry.text,
                  retry.requestId,
                  retry.confirmationOperation,
                )
              }
              disabled={busy}
            >
              Retry same request
            </button>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {state && pending && (
            <ActionPreview
              pending={pending}
              state={state}
              send={send}
              busy={busy}
            />
          )}{" "}
          {insight && !pending && <InsightCard insight={insight} />}
          {state && plan && !pending && (
            <RestockPlanCard
              plan={plan}
              previous={previous}
              state={state}
              send={send}
            />
          )}{" "}
          {receipt && (
            <section className="receipt">
              <div className="eyebrow">Recorded · receipt</div>
              <b>{receipt.kind.replaceAll("_", " ")}</b>
              <p>
                {receipt.id} · {new Date(receipt.at).toLocaleString()}
              </p>
              {receipt.data.total !== undefined && (
                <p>{money(receipt.data.total)}</p>
              )}
              <details>
                <summary>Audit details</summary>
                <pre>{JSON.stringify(receipt, null, 2)}</pre>
              </details>
            </section>
          )}
          <form
            className="command"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim())
                void send(
                  text,
                  undefined,
                  CONFIRM_WORDS.test(text) ? pending?.id : undefined,
                );
            }}
          >
            <label htmlFor="command">Your command</label>
            <div>
              <textarea
                id="command"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Ramesh ko do kilo cheeni, sau rupaye diye"
                rows={2}
                disabled={busy}
              />
              <button
                type="submit"
                className="primary"
                disabled={busy || !state}
              >
                Send command
              </button>
            </div>
          </form>
          <div className="voice">
            <button
              onClick={() => void mic()}
              disabled={busy}
              aria-pressed={listening}
            >
              {listening
                ? "Stop listening"
                : recognitionSupported
                  ? "Use microphone"
                  : "Microphone unavailable"}
            </button>
            <label>
              <input
                type="checkbox"
                checked={mute}
                onChange={(e) => {
                  setMute(e.target.checked);
                  window.speechSynthesis?.cancel();
                }}
              />
              Mute spoken responses
            </label>
            <label>
              <input
                type="checkbox"
                checked={privateScreen}
                onChange={(e) => setPrivate(e.target.checked)}
              />
              Show customer balances
            </label>
          </div>
          <details className="guide">
            <summary>Speech privacy & things to say</summary>
            <p>
              Browser speech recognition may send audio to your browser
              vendor’s cloud. Bahi stores no audio; the transcript appears in
              the box so you can check it before sending.
            </p>
            <label>
              <input
                type="checkbox"
                checked={voiceConsent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I consent to browser speech processing for this session
            </label>
            <p>
              Without a language model configured, a built-in phrase parser
              understands everyday English and Hinglish shop talk like this:
            </p>
            <ul className="command-guide">
              <li>Sold three rice and two sugar to Ramesh, he paid fifty</li>
              <li>Ramesh ko do kilo cheeni, sau rupaye diye · sold half kilo dal</li>
              <li>Meena paid two hundred · got 500 from Farooq</li>
              <li>No, that was 1 kg · that was Meena, not Ramesh · cancel that sale</li>
              <li>Who owes me money? · how much rice do I have?</li>
              <li>What's running low? · how long will sugar last?</li>
              <li>Why were sales down on Tuesday? · who's a credit risk?</li>
              <li>Which items are not moving? · show me last month by item</li>
              <li>How was today compared with last Saturday?</li>
              <li>Got 20 kilos of sugar for 900 · set price of sugar to 50</li>
              <li>Plan budget 2000 reserve 500 · leave out biscuits · save it</li>
              <li>add customer Anita · add item Tea unit packet stock 10 price 20 cost 15</li>
            </ul>
            <button onClick={() => void start(false)} disabled={busy}>
              Start empty shop for setup
            </button>
          </details>
        </section>
        <aside>
          <div className="eyebrow">Evidence shelf</div>
          <h2>{state?.shop.name ?? "From your real ledger"}</h2>
          {state ? (
            <>
              <section>
                <h3>On the shelf</h3>
                <ul className="stock">
                  {state.items.map((i) => (
                    <li key={i.id} data-testid={"stock-" + i.name}>
                      <div>
                        <strong>{i.name}</strong>
                        <small>
                          {money(i.price)} / {i.unit} · known cost{" "}
                          {i.cost === null ? "unknown" : money(i.cost)}
                        </small>
                      </div>
                      <b>
                        <Quantity qty={i.stock} unit={i.unit} />
                      </b>
                    </li>
                  ))}
                </ul>
                {!state.items.length && (
                  <p>No items yet. Use “add item” in the guide.</p>
                )}
              </section>
              <section>
                <h3>Customer credit</h3>
                {privateScreen ? (
                  <ul className="stock">
                    {[...state.customers].sort((a, b) => b.balance - a.balance).map((c) => (
                      <li key={c.name}>
                        <span>{c.name}</span>
                        <b>{money(c.balance)}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    Balances hidden.{" "}
                    {state.customers.filter((c) => c.balance > 0).length}{" "}
                    customers owe money.
                  </p>
                )}
              </section>
              <section data-testid="order-drafts">
                <h3>Unsent order drafts</h3>
                {state.drafts.length === 0 ? (
                  <p>No unsent orders.</p>
                ) : (
                  state.drafts.map((d) => (
                    <div className="draft" key={d.id}>
                      <b>{d.status}</b> · {d.id.slice(0, 8)}
                      <ul>
                        {d.lines.map((l: any) => (
                          <li key={l.item}>
                            {l.name}: {l.remaining / 1000} {l.unit} outstanding
                            of {l.qty / 1000}
                          </li>
                        ))}
                      </ul>
                      <small>Estimate {money(d.total)}</small>
                    </div>
                  ))
                )}
              </section>
              <section>
                <h3>Ledger totals</h3>
                <dl>
                  <dt>Recorded sales revenue</dt>
                  <dd>{money(state.revenue)}</dd>
                  <dt>Cash received (sales + repayments)</dt>
                  <dd>{money(state.cash)}</dd>
                  <dt>Audit events</dt>
                  <dd>{state.version}</dd>
                </dl>
                <p className="muted">
                  All time · {state.shop.timezone}. Expenses and supplier
                  payments aren't tracked, so this isn't cash in hand.
                </p>
                <details>
                  <summary>Inspect recent receipts</summary>
                  {state.events
                    .slice(-5)
                    .reverse()
                    .map((e) => (
                      <p key={e.id}>
                        <b>{e.kind.replaceAll("_", " ")}</b>
                        <small className="ids">{e.id}</small>
                      </p>
                    ))}
                </details>
              </section>
            </>
          ) : (
            <p>Opening your isolated demo ledger…</p>
          )}
          <div className="safety-note">
            Synthetic demo data. Nothing is sent to suppliers or banks.
          </div>
        </aside>
      </main>
      <footer>
        Bahi · a talking account book{" "}
        <span>Every number comes from the ledger.</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

import { FormEvent, KeyboardEvent, useRef, useState } from 'react';

type Side = 'left' | 'right';
type Route = 'both' | Side;
type MessageStatus = 'queued' | 'pending' | 'success' | 'error';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status?: MessageStatus;
  elapsedMs?: number;
};

type Threads = Record<Side, Message[]>;
type Logs = Record<Side, string>;

const sides: Side[] = ['left', 'right'];

const lucyVersions: Record<Side, string> = {
  left: 'Lucy v1.3.1',
  right: 'Lucy #550 + #556 + #559'
};

const apiBase = window.location.port === '5173'
  ? `${window.location.protocol}//${window.location.hostname}:3000`
  : '';

function apiUrl(path: string): string {
  return `${apiBase}${path}`;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function App() {
  const [prompt, setPrompt] = useState('');
  const [route, setRoute] = useState<Route>('both');
  const [threads, setThreads] = useState<Threads>({ left: [], right: [] });
  const [logs, setLogs] = useState<Logs>({ left: '', right: '' });
  const [queueDepth, setQueueDepth] = useState(0);
  const [isRestarting, setIsRestarting] = useState(false);
  const [uiStatus, setUiStatus] = useState('Ready.');
  const queueRef = useRef(Promise.resolve());
  const promptInputRef = useRef<HTMLInputElement>(null);

  const isBusy = queueDepth > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendCurrentPrompt();
  }

  function onPromptKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendCurrentPrompt();
    }
  }

  function sendCurrentPrompt() {
    const rawPrompt = promptInputRef.current?.value ?? prompt;
    const trimmedPrompt = rawPrompt.trim();

    if (!trimmedPrompt) {
      setUiStatus('Type a prompt first.');
      return;
    }

    const routedSides = route === 'both' ? sides : [route];
    const assistantIds = Object.fromEntries(
      routedSides.map((side) => [side, makeId()])
    ) as Partial<Record<Side, string>>;
    const userId = makeId();

    setThreads((current) => {
      const next = { ...current };

      for (const side of routedSides) {
        next[side] = [
          ...next[side],
          { id: `${userId}-${side}`, role: 'user', text: trimmedPrompt },
          { id: assistantIds[side]!, role: 'assistant', text: '', status: 'queued' }
        ];
      }

      return next;
    });

    setPrompt('');
    if (promptInputRef.current) {
      promptInputRef.current.value = '';
    }
    setQueueDepth((depth) => depth + 1);
    setUiStatus(`Submitted to ${routedSides.join(' + ')}.`);

    queueRef.current = queueRef.current
      .then(() => processPrompt(trimmedPrompt, routedSides, assistantIds))
      .finally(() => setQueueDepth((depth) => Math.max(0, depth - 1)));
  }

  async function processPrompt(
    text: string,
    routedSides: Side[],
    assistantIds: Partial<Record<Side, string>>
  ) {
    for (const side of routedSides) {
      updateMessage(side, assistantIds[side]!, { status: 'pending' });
    }

    await Promise.all(
      routedSides.map(async (side) => {
        try {
          updateMessage(side, assistantIds[side]!, {
            text: 'Sending to backend...',
            status: 'pending'
          });
          setUiStatus(`Sending ${side} prompt to ${apiUrl('/api/prompt')}...`);

          const response = await fetch(apiUrl('/api/prompt'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ side, prompt: text })
          });

          const body = await response.json() as { text?: string; elapsedMs?: number; error?: string };

          if (!response.ok) {
            throw new Error(body.error || `${side} request failed`);
          }

          updateMessage(side, assistantIds[side]!, {
            text: body.text ?? '',
            elapsedMs: body.elapsedMs,
            status: 'success'
          });
          setUiStatus(`${side} response received.`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          updateMessage(side, assistantIds[side]!, { text: `Request failed: ${message}`, status: 'error' });
          setUiStatus(`${side} request failed: ${message}`);
        }
      })
    );
  }

  function updateMessage(side: Side, messageId: string, patch: Partial<Message>) {
    setThreads((current) => ({
      ...current,
      [side]: current[side].map((message) => (
        message.id === messageId ? { ...message, ...patch } : message
      ))
    }));
  }

  async function restartAgents() {
    setIsRestarting(true);

    try {
      const response = await fetch(apiUrl('/api/restart'), { method: 'POST' });
      const body = await response.json().catch(() => ({})) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error || 'Agent restart failed');
      }

      clearThreads();
      setLogs({ left: '', right: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent restart failed';
      setLogs((current) => ({ ...current, left: message, right: message }));
    } finally {
      setIsRestarting(false);
    }
  }

  function clearThreads() {
    setThreads({ left: [], right: [] });
  }

  async function refreshLogs(side: Side) {
    try {
      const response = await fetch(apiUrl(`/api/logs/${side}`));
      const body = await response.json() as { logs?: string; error?: string };

      setLogs((current) => ({
        ...current,
        [side]: response.ok ? body.logs || 'No logs yet.' : body.error || 'Failed to load logs.'
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load logs.';
      setLogs((current) => ({ ...current, [side]: message }));
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Dualing AI</p>
        <h1>Agent comparison arena</h1>
        <form className="promptBar" onSubmit={submit}>
          <select value={route} onChange={(event) => setRoute(event.target.value as Route)}>
            <option value="both">Both</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
          <input
            ref={promptInputRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={onPromptKeyDown}
            placeholder="Send a prompt into the arena..."
          />
          <button type="button" aria-label="Send prompt" onClick={sendCurrentPrompt}>
            Send
          </button>
        </form>
        <div className="controls">
          <span>{isBusy ? `${queueDepth} prompt${queueDepth === 1 ? '' : 's'} queued/running` : 'Queue idle'}</span>
          <span>API: {apiBase || 'same origin'}</span>
          <span>{uiStatus}</span>
          <button type="button" onClick={clearThreads}>Clear conversations</button>
          <button type="button" onClick={restartAgents} disabled={isBusy || isRestarting}>
            {isRestarting ? 'Restarting agents...' : 'Rebuild & restart agents'}
          </button>
        </div>
      </section>

      <section className="arena">
        <Pane side="left" messages={threads.left} logs={logs.left} onRefreshLogs={() => refreshLogs('left')} />
        <Pane side="right" messages={threads.right} logs={logs.right} onRefreshLogs={() => refreshLogs('right')} />
      </section>
    </main>
  );
}

function Pane({ side, messages, logs, onRefreshLogs }: {
  side: Side;
  messages: Message[];
  logs: string;
  onRefreshLogs: () => void;
}) {
  return (
    <article className={`pane pane-${side}`}>
      <header className="paneHeader">
        <div>
          <p>{side}</p>
          <h2>{lucyVersions[side]}</h2>
        </div>
        <span className="statusDot">ready</span>
      </header>

      <div className="thread">
        {messages.length === 0 ? (
          <div className="emptyState">Awaiting transmission.</div>
        ) : messages.map((message) => (
          <MessageCard key={message.id} message={message} />
        ))}
      </div>

      <details className="logs">
        <summary onClick={onRefreshLogs}>Container logs</summary>
        <pre>{logs || 'Open to load recent logs.'}</pre>
      </details>
    </article>
  );
}

function MessageCard({ message }: { message: Message }) {
  const className = ['message', message.role, message.status].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <div className="messageMeta">
        <span>{message.role === 'user' ? 'You' : 'Agent'}</span>
        {message.status && <span>{statusText(message)}</span>}
      </div>
      <p>{message.text || placeholderText(message.status)}</p>
    </div>
  );
}

function statusText(message: Message): string {
  if (message.status === 'success' && typeof message.elapsedMs === 'number') {
    return `${(message.elapsedMs / 1000).toFixed(2)}s`;
  }

  return message.status ?? '';
}

function placeholderText(status?: MessageStatus): string {
  if (status === 'queued') {
    return 'Queued...';
  }

  if (status === 'pending') {
    return 'Thinking...';
  }

  return '';
}

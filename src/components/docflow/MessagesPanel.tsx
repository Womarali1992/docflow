import React, { useEffect, useRef, useState } from 'react';
import { I } from './icons';
import { useMessageThread } from '@/hooks/useMessageThread';

interface Props {
  /** Required for providers; ignored for a logged-in client (server self-scopes). */
  clientId?: string;
  /** Scope the thread to a single document. */
  documentId?: string;
  /** Caption shown in the composer (e.g. the document name). */
  contextDoc?: string;
  /** Which side "me" is, so bubbles align correctly. */
  meKind: 'provider' | 'client';
  title?: string;
  subtitle?: string;
}

const MessagesPanel = React.forwardRef<HTMLDivElement, Props>(function MessagesPanel(
  { clientId, documentId, contextDoc, meKind, title = 'Messages', subtitle },
  ref
) {
  const { messages, sending, send } = useMessageThread({ clientId, documentId });
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const doSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setText('');
    await send(body);
  };

  const privacyCopy = meKind === 'provider'
    ? 'Private between you and your client · ⌘↵ to send'
    : 'Private between you and your advisor · ⌘↵ to send';

  return (
    <div className="df-messages" ref={ref}>
      <div className="df-msg-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="df-title">{title}</div>
          <div className="df-sub">{subtitle ?? (contextDoc ? contextDoc : 'Thread')}</div>
        </div>
      </div>
      <div className="df-msg-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="df-muted" style={{ fontSize: 12, textAlign: 'center', padding: 12 }}>No messages yet</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={'df-msg df-' + (m.senderKind === meKind ? 'me' : 'them')}>
            <div className="df-msg-meta">
              {m.senderName} · {new Date(m.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="df-msg-bubble">{m.content}</div>
          </div>
        ))}
      </div>
      <div className="df-msg-compose">
        {contextDoc && (
          <div className="df-msg-context"><I.Doc size={11} /> Re: {contextDoc}</div>
        )}
        <textarea
          placeholder="Write a secure reply…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) doSend(); }}
        />
        <div className="df-msg-actions">
          <span className="df-small df-muted">{privacyCopy}</span>
          <button className="df-btn df-accent df-sm" onClick={doSend} disabled={sending}>
            <I.Send size={12} /> Send
          </button>
        </div>
      </div>
    </div>
  );
});

export default MessagesPanel;

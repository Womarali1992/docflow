import React from 'react';
import { I } from './icons';

/**
 * The last line before a white screen.
 *
 * A CPA in the middle of a return does not need a stack trace; they need to
 * know the work is not lost and what to press. Retry re-mounts the subtree,
 * which is enough for the render errors that actually happen (a shape the
 * server changed, a null nobody expected) — the data is in the query cache and
 * comes back with it.
 *
 * The message never contains the error text: it can carry a client's name or a
 * filename, and this can be on screen while someone else is looking.
 */
interface Props {
  children: React.ReactNode;
  /** Shown above the retry button, when a screen wants to say where it was. */
  where?: string;
}

interface State {
  failed: boolean;
}

class ErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // The console is the developer's; the screen is the user's.
    console.error('[docflow] screen failed', error, info.componentStack);
  }

  private retry = () => this.setState({ failed: false });

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="df-page">
        <div className="df-section">
          <div className="df-section-body" style={{ textAlign: 'center', padding: '40px 24px' }}>
            <div className="df-name" style={{ fontSize: 15 }}>This screen could not be shown</div>
            <div className="df-small df-muted" style={{ marginTop: 6, maxWidth: 420, marginInline: 'auto' }}>
              Nothing has been lost{this.props.where ? ` in ${this.props.where}` : ''} — nothing was saved by the attempt
              either. Try again, and if it keeps happening, tell your accountant what you were doing.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 }}>
              <button className="df-btn df-primary" onClick={this.retry}>
                <I.Refresh size={13} /> Try again
              </button>
              <button className="df-btn df-ghost" onClick={() => window.location.reload()}>
                Reload the page
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;

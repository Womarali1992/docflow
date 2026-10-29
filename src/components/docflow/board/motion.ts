import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * The boards' movement. Everything here shows something that *changed* — a line
 * that just moved, a card that changed hands — and nothing plays on page load:
 * motion is the news, not decoration. Someone who asked for less movement gets
 * none (the CSS side is handled by the reduced-motion block in styles.css).
 */

export const prefersStill = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * The ids whose value changed since the last render, for `ms` after the change.
 *
 * `signature` is `id:value` pairs joined by `|` (ids are uuids and values are
 * statuses, so neither contains a separator). Nothing is reported on the first
 * render: a page that has just opened has not changed.
 */
export function useJustChanged(signature: string, ms = 1200): Set<string> {
  const last = useRef<Map<string, string> | null>(null);
  const [changed, setChanged] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const next = new Map(
      signature
        .split('|')
        .filter(Boolean)
        .map((pair) => pair.split(':') as [string, string])
    );
    const before = last.current;
    last.current = next;
    if (!before) return;
    const fresh = [...next].filter(([id, value]) => before.has(id) && before.get(id) !== value).map(([id]) => id);
    if (fresh.length === 0) return;
    setChanged(new Set(fresh));
    const timer = window.setTimeout(() => setChanged(new Set()), ms);
    return () => window.clearTimeout(timer);
  }, [signature, ms]);

  return changed;
}

/**
 * Cards that change lanes glide there instead of jumping (FLIP: note where each
 * card was, let React move it, then play the difference backwards).
 *
 * Cards are marked `data-flip="<id>"` and `data-lane="<lane>"`. Only a card that
 * changed lane glides, and only a card that is new fades in; positions are taken
 * relative to the board, so scrolling the page between refreshes moves nothing.
 */
export function useFlip(root: RefObject<HTMLElement>, signature: string) {
  const last = useRef<Map<string, { x: number; y: number; lane: string }> | null>(null);

  useLayoutEffect(() => {
    const board = root.current;
    if (!board) return;
    const base = board.getBoundingClientRect();
    const cards = Array.from(board.querySelectorAll<HTMLElement>('[data-flip]'));
    const now = new Map(
      cards.map((card) => {
        const r = card.getBoundingClientRect();
        return [card.dataset.flip ?? '', { x: r.left - base.left, y: r.top - base.top, lane: card.dataset.lane ?? '' }];
      })
    );
    const before = last.current;
    last.current = now;
    if (!before || prefersStill()) return;

    for (const card of cards) {
      if (typeof card.animate !== 'function') continue;
      const was = before.get(card.dataset.flip ?? '');
      const is = now.get(card.dataset.flip ?? '');
      if (!is) continue;
      if (!was) {
        card.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
          duration: 280,
          easing: 'ease-out',
        });
        continue;
      }
      if (was.lane === is.lane) continue;
      const dx = was.x - is.x;
      const dy = was.y - is.y;
      card.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          {
            transform: `translate(${dx / 2}px, ${dy / 2 - 10}px) scale(1.03)`,
            boxShadow: '0 8px 24px rgba(20, 22, 28, 0.12)',
            offset: 0.5,
          },
          { transform: 'none' },
        ],
        { duration: 650, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' }
      );
    }
  }, [root, signature]);
}

/**
 * Brings a line into view and marks it for a moment, so the eye lands on it.
 * Returns false when the line is not on the page.
 */
export function revealLine(elementId: string): boolean {
  const el = document.getElementById(elementId);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: prefersStill() ? 'auto' : 'smooth' });
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  el.classList.remove('df-flash');
  void el.offsetWidth; // restart the highlight if it is still running
  el.classList.add('df-flash');
  window.setTimeout(() => el.classList.remove('df-flash'), 1600);
  return true;
}

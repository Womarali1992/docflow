import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';

/**
 * The boards' movement. Everything here shows something that *changed* — a line
 * that just moved, a card that changed hands — and nothing plays on a first
 * look: motion is the news, not decoration. Someone who asked for less movement gets
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
 * Where each Today-board card was the last time a board showed it, as
 * `column:tone`. Kept for the visit (module scope, not the component), so
 * coming back to Today after accepting something on the review screen shows it
 * arrive in "Done" — the change happened while you were away, and it is still
 * news. A reload starts afresh, and a first look animates nothing.
 */
const lastSeen = new Map<string, string>();

/** The column a card was in when it was last on screen, if it has been. */
export const seenColumn = <C extends string>(id: string): C | undefined =>
  lastSeen.get(id)?.split(':')[0] as C | undefined;

/**
 * Cards on the row board move the way the line did: one that changed column
 * slides along its row from where it was (lifting a little on the way, so it
 * reads as carried rather than redrawn); one that stayed but changed colour —
 * came due, came back — gives a short bump.
 *
 * Cards are marked `data-card`, `data-col` and `data-tone`; each row has a cell
 * per column marked `data-cell="<id>:<column>"`, which is where a card slides
 * from. `signature` lists every card as `id:column:tone`, joined by `|`.
 */
export function useBoardMotion(root: RefObject<HTMLElement>, signature: string) {
  /* Read before this render's effect writes the new places, and held with the
     render, so running the effect twice cannot make a move look like no move. */
  const before = useMemo(
    () =>
      new Map(
        signature
          .split('|')
          .filter(Boolean)
          .map((entry) => {
            const id = entry.split(':')[0];
            return [id, lastSeen.get(id)] as const;
          })
      ),
    [signature]
  );

  useLayoutEffect(() => {
    const board = root.current;
    if (!board) return;
    const cards = Array.from(board.querySelectorAll<HTMLElement>('[data-card]'));
    const still = prefersStill();
    const running: Animation[] = [];

    for (const card of cards) {
      const id = card.dataset.card ?? '';
      const column = card.dataset.col ?? '';
      const tone = card.dataset.tone ?? '';
      lastSeen.set(id, `${column}:${tone}`);
      const was = before.get(id);
      if (!was || still || typeof card.animate !== 'function') continue;
      const [wasColumn, wasTone] = was.split(':');

      if (wasColumn !== column) {
        const from = board.querySelector<HTMLElement>(`[data-cell="${id}:${wasColumn}"]`);
        if (!from) continue;
        const a = from.getBoundingClientRect();
        const b = card.getBoundingClientRect();
        const dx = a.left + a.width / 2 - (b.left + b.width / 2);
        running.push(
          card.animate(
            [
              { transform: `translateX(${dx}px)` },
              { transform: `translate(${dx / 2}px, -8px) scale(1.06)`, boxShadow: '0 10px 24px rgba(20, 22, 28, 0.16)', offset: 0.5 },
              { transform: 'none' },
            ],
            { duration: 800, delay: 200, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'backwards' }
          )
        );
      } else if (wasTone !== tone) {
        running.push(
          card.animate([{ transform: 'none' }, { transform: 'scale(1.12)', offset: 0.35 }, { transform: 'none' }], {
            duration: 520,
            delay: 200,
            easing: 'ease-out',
          })
        );
      }
    }
    return () => running.forEach((animation) => animation.cancel());
  }, [root, before]);
}

/**
 * Tiles that change column glide there instead of jumping (FLIP: note where each
 * tile was, let React move it, then play the difference backwards). Used by the
 * checklist columns, where a tile lives inside its column's list.
 *
 * Tiles are marked `data-flip="<id>"` and `data-lane="<column>"`. Only a tile
 * that changed column glides, and nothing moves on the first render; positions
 * are taken relative to the board, so scrolling between refreshes moves nothing.
 */
export function useFlip(root: RefObject<HTMLElement>, signature: string) {
  const last = useRef<Map<string, { x: number; y: number; lane: string }> | null>(null);

  useLayoutEffect(() => {
    const board = root.current;
    if (!board) return;
    const base = board.getBoundingClientRect();
    const tiles = Array.from(board.querySelectorAll<HTMLElement>('[data-flip]'));
    const now = new Map(
      tiles.map((tile) => {
        const r = tile.getBoundingClientRect();
        return [tile.dataset.flip ?? '', { x: r.left - base.left, y: r.top - base.top, lane: tile.dataset.lane ?? '' }];
      })
    );
    const before = last.current;
    last.current = now;
    if (!before || prefersStill()) return;

    for (const tile of tiles) {
      if (typeof tile.animate !== 'function') continue;
      const was = before.get(tile.dataset.flip ?? '');
      const is = now.get(tile.dataset.flip ?? '');
      if (!was || !is || was.lane === is.lane) continue;
      const dx = was.x - is.x;
      const dy = was.y - is.y;
      tile.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: `translate(${dx / 2}px, ${dy / 2 - 10}px) scale(1.04)`, offset: 0.5 },
          { transform: 'none' },
        ],
        { duration: 700, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' }
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

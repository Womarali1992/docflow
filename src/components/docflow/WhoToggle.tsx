import React from 'react';
import type { QueueWho } from '@/api/types';

/** Mine / Everyone on the queue (FIRM-BOOK-PLAN F6). The caller hides it while the firm has one advisor. */
const WhoToggle: React.FC<{ who: QueueWho; onChange: (who: QueueWho) => void }> = ({ who, onChange }) => (
  <div className="df-seg" role="tablist" aria-label="Whose work">
    <button className={who === 'mine' ? 'df-active' : ''} onClick={() => onChange('mine')} title="Your clients, and the firm's unassigned ones">
      Mine
    </button>
    <button className={who === 'all' ? 'df-active' : ''} onClick={() => onChange('all')} title="Every client of the firm">
      Everyone
    </button>
  </div>
);

export default WhoToggle;

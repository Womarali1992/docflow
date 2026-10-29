import React, { useState } from 'react';
import Modal from './Modal';
import { activeAdvisors, useAssignClient, useFirm } from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import type { Client } from '@/api/types';

/**
 * "Advisor: Sarah Mitchell · Change" under a client's name (FIRM-BOOK-PLAN F5).
 * Any advisor of the firm may move a client; the move is audited and shows on
 * the client's activity. Nothing at all is shown while the firm has one
 * advisor: there is nobody to choose between.
 */
const AssignAdvisor: React.FC<{ client: Client }> = ({ client }) => {
  const { toast } = useToast();
  const { data: firm } = useFirm();
  const assign = useAssignClient();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');

  const advisors = activeAdvisors(firm);
  if (advisors.length < 2) return null;

  const save = async () => {
    const advisorId = choice || null;
    try {
      await assign.mutateAsync({ id: client.id, advisorId });
      const name = advisors.find((a) => a.id === advisorId)?.name;
      toast({ title: name ? `${client.name} is now ${name}’s` : `${client.name} is unassigned`, description: 'The client’s portal shows the change; they are not emailed.' });
      setOpen(false);
    } catch (e) {
      toast({ title: 'Could not change the advisor', description: getErrorMessage(e), variant: 'destructive' });
    }
  };

  return (
    <>
      <span className="df-dot-sep" />
      <span>
        Advisor: {client.assignedAdvisorName ?? <em>unassigned</em>}
        {' · '}
        <button className="df-link" onClick={() => { setChoice(client.assignedAdvisorId ?? ''); setOpen(true); }}>Change</button>
      </span>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Who looks after ${client.name}?`}
        subtitle="They hear about this client's uploads and messages, and the client sees their name in the portal."
        footer={
          <>
            <button className="df-btn df-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="df-btn df-primary" disabled={assign.isPending || choice === (client.assignedAdvisorId ?? '')} onClick={save}>
              {assign.isPending ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <div className="df-form">
          <label className="df-field">
            <span className="df-field-label">Advisor</span>
            <select className="df-input" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Nobody: the whole firm hears from them</option>
              {advisors.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
        </div>
      </Modal>
    </>
  );
};

export default AssignAdvisor;

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { I } from './icons';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}

/**
 * App-styled modal built on Radix Dialog. The portal renders at <body>, so the
 * content carries `df-root` to inherit the --df-* theme tokens.
 */
const Modal: React.FC<ModalProps> = ({ open, onClose, title, subtitle, children, footer, width = 460 }) => (
  <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="df-root df-modal-overlay" />
      <Dialog.Content className="df-root df-modal" style={{ maxWidth: width }} aria-describedby={undefined}>
        <div className="df-modal-head">
          <div style={{ minWidth: 0 }}>
            <Dialog.Title className="df-modal-title">{title}</Dialog.Title>
            {subtitle && <Dialog.Description className="df-modal-sub">{subtitle}</Dialog.Description>}
          </div>
          <button className="df-icon-btn" onClick={onClose} aria-label="Close"><I.X size={15} /></button>
        </div>
        <div className="df-modal-body">{children}</div>
        {footer && <div className="df-modal-foot">{footer}</div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);

export default Modal;

import React from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}

const Modal: React.FC<ModalProps> = ({ open, title, onClose, children, wide }) => {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto">
      <div
        className="flex min-h-full items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className={`bs-card w-full max-h-[min(90vh,calc(100vh-3rem))] overflow-y-auto custom-scrollbar my-auto ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-bs-border sticky top-0 bg-bs-surface z-10">
            <h3 className="font-bold text-bs-text">{title}</h3>
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-bs-hover text-bs-muted">
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <div className="p-5">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default Modal;

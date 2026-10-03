// src/contexts/ConfirmContext.jsx
//
// Promise-based confirm dialog. `showConfirm(options)` opens ConfirmModal and
// resolves to true (confirmed) or false (cancelled), so an action reads as
// `if (!(await showConfirm({...}))) return;`.

import { createContext, useContext, useState } from 'react';

const ConfirmContext = createContext();

/** Holds the state of the one app-wide confirm dialog (rendered in App.jsx). */
export function ConfirmProvider({ children }) {
  const [confirmState, setConfirmState] = useState({
    isOpen: false,
    title: 'Are you sure?',
    message: 'This action cannot be undone.',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    confirmVariant: 'danger', // 'danger' | 'warning' | 'success'
    onConfirm: null,
  });

  const showConfirm = (options) => {
    return new Promise((resolve) => {
      setConfirmState({
        isOpen: true,
        title: options.title || 'Are you sure?',
        message: options.message || 'This action cannot be undone.',
        confirmLabel: options.confirmLabel || 'Confirm',
        cancelLabel: options.cancelLabel || 'Cancel',
        confirmVariant: options.confirmVariant || 'danger',
        onConfirm: () => {
          resolve(true);
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
        },
        onCancel: () => {
          resolve(false);
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
        },
      });
    });
  };

  const hideConfirm = () => {
    setConfirmState((prev) => ({ ...prev, isOpen: false }));
  };

  return (
    <ConfirmContext.Provider value={{ showConfirm, hideConfirm, confirmState }}>
      {children}
    </ConfirmContext.Provider>
  );
}

/** { showConfirm } — `await showConfirm({ title, message, confirmLabel, confirmVariant })` resolves true/false. */
export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context;
}
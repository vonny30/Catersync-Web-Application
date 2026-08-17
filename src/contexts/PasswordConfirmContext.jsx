// src/contexts/PasswordConfirmContext.jsx
//
// Re-verifies the currently logged-in manager's own password before a
// permanent-delete action proceeds — confirms "it's really you", not a
// separate secret to manage. Mirrors ConfirmContext's shape/usage exactly
// (requestPasswordConfirm() returns a Promise<boolean>, state rendered by
// AppContent) so callers reach for it the same way they already reach for
// showConfirm().
import { createContext, useContext, useState } from 'react';
import { useAuth } from './AuthContext';
import { verifyPassword } from '../utils/verifyPassword';

const PasswordConfirmContext = createContext();

export function PasswordConfirmProvider({ children }) {
  const { user } = useAuth();
  const [passwordConfirmState, setPasswordConfirmState] = useState({
    isOpen: false,
    title: 'Confirm Your Password',
    message: 'This action is permanent. Re-enter your password to continue.',
    password: '',
    error: '',
    verifying: false,
    onConfirm: null,
    onCancel: null,
  });

  const requestPasswordConfirm = (options = {}) => {
    return new Promise((resolve) => {
      const close = (result) => {
        resolve(result);
        setPasswordConfirmState((prev) => ({ ...prev, isOpen: false }));
      };

      const verify = async (password) => {
        if (!password) {
          setPasswordConfirmState((prev) => ({ ...prev, error: 'Please enter your password.' }));
          return;
        }
        if (!user?.email) {
          setPasswordConfirmState((prev) => ({ ...prev, error: 'No active session found. Please refresh and try again.' }));
          return;
        }
        setPasswordConfirmState((prev) => ({ ...prev, verifying: true, error: '' }));
        try {
          const isCorrect = await verifyPassword(user.email, password);
          if (!isCorrect) {
            setPasswordConfirmState((prev) => ({ ...prev, verifying: false, error: 'Incorrect password. Please try again.' }));
            return;
          }
          setPasswordConfirmState((prev) => ({ ...prev, verifying: false }));
          close(true);
        } catch (err) {
          console.error('Password confirm error:', err);
          setPasswordConfirmState((prev) => ({ ...prev, verifying: false, error: 'Something went wrong verifying your password. Please try again.' }));
        }
      };

      setPasswordConfirmState({
        isOpen: true,
        title: options.title || 'Confirm Your Password',
        message: options.message || 'This action is permanent. Re-enter your password to continue.',
        password: '',
        error: '',
        verifying: false,
        onConfirm: verify,
        onCancel: () => close(false),
      });
    });
  };

  const setPassword = (password) => {
    setPasswordConfirmState((prev) => ({ ...prev, password, error: '' }));
  };

  return (
    <PasswordConfirmContext.Provider value={{ requestPasswordConfirm, passwordConfirmState, setPassword }}>
      {children}
    </PasswordConfirmContext.Provider>
  );
}

export function usePasswordConfirm() {
  const context = useContext(PasswordConfirmContext);
  if (!context) {
    throw new Error('usePasswordConfirm must be used within a PasswordConfirmProvider');
  }
  return context;
}

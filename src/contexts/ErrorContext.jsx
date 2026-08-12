// src/contexts/ErrorContext.jsx
import React, { createContext, useContext, useState } from 'react';

const ErrorContext = createContext();

export function ErrorProvider({ children }) {
  const [errorState, setErrorState] = useState({
    isOpen: false,
    message: '',
    onRetry: null,
  });

  const showError = (message, onRetry = null) => {
    setErrorState({
      isOpen: true,
      message,
      onRetry: onRetry || null,
    });
  };

  const hideError = () => {
    setErrorState({
      isOpen: false,
      message: '',
      onRetry: null,
    });
  };

  return (
    <ErrorContext.Provider value={{ showError, hideError, errorState }}>
      {children}
    </ErrorContext.Provider>
  );
}

export function useError() {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useError must be used within an ErrorProvider');
  }
  return context;
}
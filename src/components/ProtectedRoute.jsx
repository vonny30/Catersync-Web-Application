// src/components/ProtectedRoute.jsx
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const ProtectedRoute = ({ children }) => {
  const { user, loading, isManager } = useAuth();

  if (loading) {
    // Show a loading spinner or skeleton
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#008A45]"></div>
      </div>
    );
  }

  if (!user || !isManager) {
    return <Navigate to="/login" replace />;
  }

  return children;
};
// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorProvider } from './contexts/ErrorContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import ConfirmModal from './components/ConfirmModal';
import { useConfirm } from './contexts/ConfirmContext';
import ManagerLayout from './layouts/ManagerLayout';
import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import BookingDetails from './pages/BookingDetails';
import ShortOrders from './pages/ShortOrders';
import ShortOrderDetails from './pages/ShortOrderDetails';
import Payments from './pages/Payments';
import Equipment from './pages/Equipment';
import Vehicles from './pages/Vehicles';
import Reports from './pages/Reports';
import PackagesAndMenus from './pages/PackagesAndMenus';
import SettingsPage from './pages/SettingsPage';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import LoadingScreen from './components/LoadingScreen';

function AppContent() {
  const { confirmState } = useConfirm();
  const { initializing } = useAuth();

  if (initializing) {
    return <LoadingScreen />;
  }

  return (
    <>
      <Toaster
        position="top-center"
        containerStyle={{ zIndex: 999999, top: 24 }}
        toastOptions={{
          duration: 4000,
          style: {
            background: '#1f2937',
            color: '#fff',
            padding: '18px 24px',
            borderRadius: '10px',
            fontSize: '16px',
            fontWeight: 500,
            maxWidth: '560px',
            boxShadow: '0 10px 40px -5px rgba(0, 0, 0, 0.4)',
          },
          success: {
            duration: 3500,
            iconTheme: {
              primary: '#008A45',
              secondary: '#fff',
            },
            style: {
              border: '2px solid #008A45',
            },
          },
          error: {
            duration: 5500,
            iconTheme: {
              primary: '#ef4444',
              secondary: '#fff',
            },
            style: {
              border: '2px solid #ef4444',
            },
          },
        }}
      />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route
          path="/app/*"
          element={
            <ProtectedRoute>
              <ManagerLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="bookings" element={<Bookings />} />
          <Route path="bookings/:id" element={<BookingDetails />} />
          <Route path="orders" element={<ShortOrders />} />
          <Route path="orders/:id" element={<ShortOrderDetails />} />
          <Route path="payments" element={<Payments />} />
          <Route path="equipment" element={<Equipment />} />
          <Route path="vehicles" element={<Vehicles />} />
          <Route path="reports" element={<Reports />} />
          <Route path="packages-menu" element={<PackagesAndMenus />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        {/* ✅ Catch-all: redirect to login */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        cancelLabel={confirmState.cancelLabel}
        confirmVariant={confirmState.confirmVariant}
        onConfirm={confirmState.onConfirm || (() => {})}
        onCancel={confirmState.onCancel || (() => {})}
      />
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorProvider>
          <ConfirmProvider>
            <AppContent />
          </ConfirmProvider>
        </ErrorProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
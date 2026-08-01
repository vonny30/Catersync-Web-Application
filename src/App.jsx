// src/App.jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
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

function AppContent() {
  const { confirmState } = useConfirm();

  return (
    <>
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#363636',
            color: '#fff',
            padding: '16px',
            borderRadius: '8px',
            fontSize: '14px',
          },
          success: {
            duration: 3000,
            iconTheme: {
              primary: '#008A45',
              secondary: '#fff',
            },
          },
          error: {
            duration: 5000,
            iconTheme: {
              primary: '#ef4444',
              secondary: '#fff',
            },
          },
        }}
      />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/app"
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
      </Routes>

      {/* Global Confirmation Modal */}
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
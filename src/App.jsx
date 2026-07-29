// App.jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
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

function App() {
  return (
    <BrowserRouter>
      {/* AuthProvider provides authentication state to all routes */}
      <AuthProvider>
        <Routes>
          {/* Public route – login page */}
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />

          {/* Protected routes – wrapped with ProtectedRoute */}
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

          {/* Optional: catch-all redirect to /app (if user is logged in) or /login (if not) */}
          {/* But ProtectedRoute will handle unauthenticated redirects, so we can keep it simple */}
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
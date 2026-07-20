// App.jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
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
      <Routes>
        {/* Login page is now the root */}
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />

        {/* All protected routes are under /app */}
        <Route path="/app" element={<ManagerLayout />}>
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
    </BrowserRouter>
  );
}

export default App;
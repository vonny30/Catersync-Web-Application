// pages/BookingDetails.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, X, Plus, RefreshCw } from 'lucide-react';
import { supabase } from '../supabase';

export default function BookingDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [menuSelections, setMenuSelections] = useState([]); // Array of {category_name, menu_name}
  const [equipment, setEquipment] = useState([]); // Array of {eqm_name, quantity, returned}

  const fetchBooking = async () => {
    setLoading(true);
    try {
      // 1. Fetch booking with customer and package
      const { data: bookingData, error: bookingError } = await supabase
        .from('booking')
        .select(`
          *,
          customer:customer_id (first_name, last_name, contact_no, cus_address),
          package:package_id (pkg_name, pkg_price, pkg_description)
        `)
        .eq('booking_id', id)
        .single();
      if (bookingError) throw bookingError;
      setBooking(bookingData);

      // 2. Fetch payments
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payment')
        .select('*')
        .eq('booking_id', id)
        .order('pay_datetime', { ascending: false });
      if (paymentsError) throw paymentsError;
      setPayments(paymentsData || []);

      // 3. Fetch menu selections (if any)
      if (bookingData.menu_selections && Object.keys(bookingData.menu_selections).length > 0) {
        const selections = bookingData.menu_selections;
        const categoryIds = Object.keys(selections);
        const menuItemIds = Object.values(selections);

        // Fetch category names
        const { data: categories, error: catError } = await supabase
          .from('category')
          .select('category_id, category_name')
          .in('category_id', categoryIds);
        if (catError) throw catError;

        // Fetch menu item names
        const { data: menuItems, error: menuError } = await supabase
          .from('menu_item')
          .select('menu_item_id, menu_name')
          .in('menu_item_id', menuItemIds);
        if (menuError) throw menuError;

        // Build the selections array
        const selectionsList = categoryIds.map(catId => {
          const category = categories?.find(c => c.category_id === catId);
          const menuItemId = selections[catId];
          const menuItem = menuItems?.find(m => m.menu_item_id === menuItemId);
          return {
            category_name: category?.category_name || 'Unknown Category',
            menu_name: menuItem?.menu_name || 'Unknown Menu Item',
          };
        });
        setMenuSelections(selectionsList);
      } else {
        setMenuSelections([]);
      }

      // 4. Fetch equipment allocations for this booking
      const { data: equipData, error: equipError } = await supabase
        .from('booking_equipment')
        .select(`
          quantity,
          returned,
          equipment:equipment_id (eqm_name)
        `)
        .eq('booking_id', id)
        .order('assigned_at', { ascending: true });
      if (equipError) throw equipError;
      setEquipment(
        equipData?.map(item => ({
          eqm_name: item.equipment?.eqm_name || 'Unknown',
          quantity: item.quantity,
          returned: item.returned,
        })) || []
      );

    } catch (error) {
      console.error('Error fetching booking details:', error);
      alert('Failed to load booking details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBooking();
  }, [id]);

  const handleApprove = async () => {
    try {
      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Approved' })
        .eq('booking_id', id);
      if (error) throw error;
      fetchBooking();
    } catch (error) {
      alert('Failed to approve.');
    }
  };

  const handleReject = async () => {
    if (!confirm('Cancel this booking?')) return;
    try {
      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Rejected' })
        .eq('booking_id', id);
      if (error) throw error;
      fetchBooking();
    } catch (error) {
      alert('Failed to reject.');
    }
  };

  if (loading) return <div className="p-12 text-center text-slate-500 font-medium">Loading...</div>;
  if (!booking) return <div className="p-12 text-center text-slate-500">Booking not found.</div>;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/bookings')}
            className="w-10 h-10 bg-white border border-slate-300 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors shadow-xs"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {booking.customer?.first_name} {booking.customer?.last_name}
            </h1>
            <p className="text-xs text-slate-500">Booking ID: {booking.booking_id}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {booking.booking_status === 'Pending' && (
            <>
              <button onClick={handleApprove} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm">
                <Check size={18} /> Approve
              </button>
              <button onClick={handleReject} className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm">
                <X size={18} /> Cancel
              </button>
            </>
          )}
          <button onClick={fetchBooking} className="bg-white border border-slate-300 text-slate-700 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Status Badge */}
      <div>
        <span className={`px-4 py-1.5 rounded-full text-xs font-bold border ${
          booking.booking_status === 'Pending' ? 'bg-amber-50 border-amber-200 text-amber-700' :
          booking.booking_status === 'Approved' ? 'bg-[#EAF3F2] border-[#C1DEDC] text-slate-800' :
          booking.booking_status === 'Completed' ? 'bg-blue-50 border-blue-200 text-blue-700' :
          'bg-red-50 border-red-200 text-red-700'
        }`}>
          {booking.booking_status}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: Event & Client */}
        <div className="lg:col-span-5 space-y-6">
          {/* Event Details */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Event Details</h3>
            <div className="space-y-2.5 text-sm">
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Date</span><span className="col-span-2">{booking.event_datetime ? new Date(booking.event_datetime).toLocaleString() : 'N/A'}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Venue</span><span className="col-span-2">{booking.venue || 'N/A'}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Pax</span><span className="col-span-2">{booking.pax_count}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Package</span><span className="col-span-2">{booking.package?.pkg_name || 'None'}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Color</span><span className="col-span-2">{booking.motif_color || 'N/A'}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Total</span><span className="col-span-2 font-bold">₱{booking.total_amount?.toLocaleString() || '0'}</span></div>
            </div>
            {booking.notes && (
              <div className="pt-4 mt-4 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-900 block mb-1">Notes</span>
                <p className="text-xs text-slate-500">{booking.notes}</p>
              </div>
            )}
          </div>

          {/* Client Details */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Client Details</h3>
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Name</span><span className="col-span-2">{booking.customer?.first_name} {booking.customer?.last_name}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Contact</span><span className="col-span-2">{booking.customer?.contact_no || 'N/A'}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Address</span><span className="col-span-2">{booking.customer?.cus_address || 'N/A'}</span></div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Payments, Menu Selections, Equipment */}
        <div className="lg:col-span-7 space-y-6">

          {/* Payment Tracking */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-900">Payment Tracking</h3>
              <button className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-2xs">
                <Plus size={14} /> Record Payment
              </button>
            </div>
            <div className="border border-slate-300 rounded-lg overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-[#EAF3F2] text-slate-900 font-bold border-b border-slate-300">
                    <th className="p-3">Amount</th>
                    <th className="p-3">Method</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {payments.length === 0 ? (
                    <tr><td colSpan="4" className="p-3 text-center text-slate-400 italic">No payments recorded.</td></tr>
                  ) : (
                    payments.map(p => (
                      <tr key={p.payment_id}>
                        <td className="p-3 font-bold">₱{p.amount_paid?.toLocaleString() || '0'}</td>
                        <td className="p-3">{p.pay_method || 'N/A'}</td>
                        <td className="p-3">{p.pay_status || 'N/A'}</td>
                        <td className="p-3">{p.pay_datetime ? new Date(p.pay_datetime).toLocaleString() : 'N/A'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Menu Selections */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-900">Menu Selections</h3>
              <span className="text-xs font-medium text-slate-500">{menuSelections.length} item{menuSelections.length !== 1 ? 's' : ''}</span>
            </div>
            {menuSelections.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No menu selections recorded.</p>
            ) : (
              <div className="space-y-2">
                {menuSelections.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
                    <span className="text-sm font-semibold text-slate-700">{item.category_name}</span>
                    <span className="text-sm font-medium text-slate-900 bg-white px-3 py-1 rounded-full border border-slate-300">
                      {item.menu_name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Equipment Allocation */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-900">Equipment Allocation</h3>
              <span className="text-xs font-medium text-slate-500">{equipment.length} item{equipment.length !== 1 ? 's' : ''}</span>
            </div>
            {equipment.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No equipment allocated.</p>
            ) : (
              <div className="space-y-2">
                {equipment.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
                    <div>
                      <span className="text-sm font-semibold text-slate-700">{item.eqm_name}</span>
                      <span className="text-xs text-slate-500 ml-2">× {item.quantity}</span>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      item.returned
                        ? 'bg-green-100 border border-green-200 text-green-700'
                        : 'bg-amber-100 border border-amber-200 text-amber-700'
                    }`}>
                      {item.returned ? '✅ Returned' : '📌 Assigned'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
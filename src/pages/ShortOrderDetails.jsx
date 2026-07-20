// pages/ShortOrderDetails.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { supabase } from '../supabase';

export default function ShortOrderDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [menuItemsDetails, setMenuItemsDetails] = useState([]);

  const fetchOrder = async () => {
    setLoading(true);
    try {
      // 1. Fetch the order
      const { data: orderData, error: orderError } = await supabase
        .from('booking')
        .select(`
          *,
          customer:customer_id (first_name, last_name, contact_no, cus_address)
        `)
        .eq('booking_id', id)
        .single();
      if (orderError) throw orderError;
      setOrder(orderData);

      // 2. Parse menu selections
      let selections = [];
      if (orderData.menu_selections) {
        try {
          if (typeof orderData.menu_selections === 'string') {
            selections = JSON.parse(orderData.menu_selections);
          } else if (Array.isArray(orderData.menu_selections)) {
            selections = orderData.menu_selections;
          }
        } catch (e) {
          selections = [];
        }
      }

      // 3. Fetch menu item details for the selections
      if (selections.length > 0) {
        const menuItemIds = selections.map(s => s.menu_item_id);
        const { data: menuData, error: menuError } = await supabase
          .from('menu_item')
          .select('menu_item_id, menu_name, menu_price')
          .in('menu_item_id', menuItemIds);
        if (menuError) throw menuError;

        // Combine with quantities
        const itemsWithDetails = selections.map(sel => {
          const menu = menuData.find(m => m.menu_item_id === sel.menu_item_id);
          return {
            menu_item_id: sel.menu_item_id,
            quantity: sel.quantity,
            menu_name: menu?.menu_name || 'Unknown Item',
            menu_price: menu?.menu_price || 0,
          };
        });
        setMenuItemsDetails(itemsWithDetails);
      } else {
        setMenuItemsDetails([]);
      }

      // 4. Fetch payments
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payment')
        .select('*')
        .eq('booking_id', id)
        .order('pay_datetime', { ascending: false });
      if (paymentsError) throw paymentsError;
      setPayments(paymentsData || []);
    } catch (error) {
      console.error('Error fetching order details:', error);
      alert('Failed to load order.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrder();
  }, [id]);

  if (loading) return <div className="p-12 text-center text-slate-500 font-medium">Loading...</div>;
  if (!order) return <div className="p-12 text-center text-slate-500">Order not found.</div>;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/orders')} className="w-10 h-10 bg-white border border-slate-300 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-50 shadow-xs">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{order.customer?.first_name} {order.customer?.last_name}</h1>
            <p className="text-xs text-slate-500">Order ID: {order.booking_id}</p>
          </div>
        </div>
        <button onClick={fetchOrder} className="bg-white border border-slate-300 text-slate-700 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50">
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div>
        <span className={`px-4 py-1.5 rounded-full text-xs font-bold border ${
          order.booking_status === 'Pending' ? 'bg-amber-50 border-amber-200 text-amber-700' :
          order.booking_status === 'Approved' ? 'bg-[#EAF3F2] border-[#C1DEDC] text-slate-800' :
          order.booking_status === 'Completed' ? 'bg-blue-50 border-blue-200 text-blue-700' :
          'bg-red-50 border-red-200 text-red-700'
        }`}>
          {order.booking_status}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: Order & Client Details */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Order Details</h3>
            <div className="space-y-2.5 text-sm">
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Date</span><span className="col-span-2">{order.event_datetime ? new Date(order.event_datetime).toLocaleString() : 'N/A'}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Venue</span><span className="col-span-2">{order.venue || 'N/A'}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Pax</span><span className="col-span-2">{order.pax_count}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Delivery Fee</span><span className="col-span-2">₱{order.delivery_fee?.toLocaleString() || '0'}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Total</span><span className="col-span-2 font-bold text-[#008A45]">₱{order.total_amount?.toLocaleString() || '0'}</span></div>
            </div>
            {order.notes && (
              <div className="pt-4 mt-4 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-900 block mb-1">Notes</span>
                <p className="text-xs text-slate-500">{order.notes}</p>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Client</h3>
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Name</span><span className="col-span-2">{order.customer?.first_name} {order.customer?.last_name}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Contact</span><span className="col-span-2">{order.customer?.contact_no || 'N/A'}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Address</span><span className="col-span-2">{order.customer?.cus_address || 'N/A'}</span></div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Menu Items & Payments */}
        <div className="lg:col-span-7 space-y-6">

          {/* Ordered Items */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-900">Ordered Items</h3>
              <span className="text-xs font-medium text-slate-500">{menuItemsDetails.length} item{menuItemsDetails.length !== 1 ? 's' : ''}</span>
            </div>
            {menuItemsDetails.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No items selected.</p>
            ) : (
              <div className="space-y-2">
                {menuItemsDetails.map((item, idx) => {
                  const subtotal = item.menu_price * item.quantity;
                  return (
                    <div key={idx} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
                      <div>
                        <span className="text-sm font-semibold text-slate-700">{item.menu_name}</span>
                        <span className="text-xs text-slate-500 ml-2">× {item.quantity}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-500 block">₱{item.menu_price.toFixed(2)} / unit</span>
                        <span className="text-sm font-bold text-slate-900">₱{subtotal.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })}
                <div className="flex justify-end pt-2 border-t border-slate-200 mt-1">
                  <span className="text-sm font-bold text-slate-900">
                    Subtotal: ₱{menuItemsDetails.reduce((sum, i) => sum + (i.menu_price * i.quantity), 0).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Payment Tracking */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Payment Tracking</h3>
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
                    <tr><td colSpan="4" className="p-3 text-center text-slate-400 italic">No payments.</td></tr>
                  ) : payments.map(p => (
                    <tr key={p.payment_id}>
                      <td className="p-3 font-bold">₱{p.amount_paid?.toLocaleString() || '0'}</td>
                      <td className="p-3">{p.pay_method || 'N/A'}</td>
                      <td className="p-3">{p.pay_status || 'N/A'}</td>
                      <td className="p-3">{p.pay_datetime ? new Date(p.pay_datetime).toLocaleString() : 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
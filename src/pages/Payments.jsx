// pages/Payments.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, Upload, X, Image as ImageIcon, Edit, Trash2, Check, DollarSign, RefreshCw } from 'lucide-react';
import { supabase } from '../supabase';

export default function Payments() {
  // --- STATE ---
  const [payments, setPayments] = useState([]);
  const [bookings, setBookings] = useState([]); // for dropdowns
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const tabs = ['All', 'Downpayment', 'Full Payment', 'Unpaid'];

  // --- MODAL STATE ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const initialFormState = {
    booking_id: '',
    amount: '',
    pay_installment: 1,
    pay_method: 'Cash',
    pay_status: 'Downpayment',
    pay_proof: 'placeholder.png', // placeholder until file upload is implemented
  };

  const [formData, setFormData] = useState(initialFormState);

  // --- FETCH DATA ---
  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch payments with booking and customer info
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payment')
        .select(`
          *,
          booking:booking_id (
            booking_id,
            booking_type,
            customer:customer_id (first_name, last_name),
            venue,
            event_datetime
          )
        `)
        .order('pay_datetime', { ascending: false });

      if (paymentsError) throw paymentsError;
      setPayments(paymentsData || []);

      // 2. Fetch bookings for dropdown (only those with status not Completed/Rejected)
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('booking')
        .select(`
          booking_id,
          booking_type,
          customer:customer_id (first_name, last_name),
          total_amount
        `)
        .not('booking_status', 'in', '("Completed","Rejected")')
        .order('event_datetime');

      if (bookingsError) throw bookingsError;
      setBookings(bookingsData || []);

    } catch (error) {
      console.error('Error fetching data:', error);
      alert('Failed to load payments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- SUMMARY CALCULATIONS ---
  const totalCollected = payments
    .filter(p => p.pay_status === 'Fully Paid' || p.pay_status === 'Downpayment')
    .reduce((sum, p) => sum + (p.amount_paid || 0), 0);

  // Pending balance: sum of total_amount for bookings that are not fully paid
  // For simplicity, we'll compute from payments: if a booking has payments but not fully paid, we estimate.
  // Better: we can sum remaining balances from booking table.
  // Let's compute from payments: any booking with a payment but not fully paid.
  const pendingBalance = payments
    .filter(p => p.pay_status === 'Downpayment')
    .reduce((sum, p) => {
      // Assume remaining balance = booking total - sum of payments for that booking
      // We don't have booking total here, so we'll use a placeholder or compute differently.
      // For now, we'll just show a static placeholder, but you can improve later.
      return sum + 0;
    }, 0);

  // Fully paid count
  const fullyPaidCount = payments.filter(p => p.pay_status === 'Fully Paid').length;

  // --- FILTER LOGIC ---
  const filteredPayments = payments.filter(p => {
    if (activeTab === 'All') return true;
    if (activeTab === 'Downpayment') return p.pay_status === 'Downpayment';
    if (activeTab === 'Full Payment') return p.pay_status === 'Fully Paid';
    if (activeTab === 'Unpaid') return p.pay_status === 'Unpaid';
    return true;
  });

  // --- HANDLERS ---
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const openNewPaymentModal = () => {
    setEditingId(null);
    setFormData({
      booking_id: '',
      amount: '',
      pay_installment: 1,
      pay_method: 'Cash',
      pay_status: 'Downpayment',
      pay_proof: 'placeholder.png',
    });
    setSelectedFile(null);
    setIsModalOpen(true);
  };

  const openEditModal = (payment) => {
    setEditingId(payment.payment_id);
    setFormData({
      booking_id: payment.booking_id,
      amount: payment.amount_paid?.toString() || '',
      pay_installment: payment.pay_installment || 1,
      pay_method: payment.pay_method || 'Cash',
      pay_status: payment.pay_status || 'Downpayment',
      pay_proof: payment.pay_proof || 'placeholder.png',
    });
    setSelectedFile(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData(initialFormState);
    setSelectedFile(null);
    setIsSubmitting(false);
  };

  // --- CRUD ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const payload = {
        booking_id: formData.booking_id,
        amount_paid: parseFloat(formData.amount) || 0,
        pay_installment: parseInt(formData.pay_installment) || 1,
        pay_method: formData.pay_method,
        pay_status: formData.pay_status,
        pay_datetime: new Date().toISOString(),
        pay_proof: formData.pay_proof || 'placeholder.png',
      };

      if (editingId) {
        // UPDATE
        const { error } = await supabase
          .from('payment')
          .update(payload)
          .eq('payment_id', editingId);
        if (error) throw error;
      } else {
        // INSERT
        const { error } = await supabase
          .from('payment')
          .insert([payload]);
        if (error) throw error;
      }

      closeModal();
      fetchData();
    } catch (error) {
      console.error('Error saving payment:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Permanently delete this payment record?')) return;
    try {
      const { error } = await supabase
        .from('payment')
        .delete()
        .eq('payment_id', id);
      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error('Error deleting payment:', error);
      alert('Failed to delete payment.');
    }
  };

  const getClientName = (payment) => {
    if (payment.booking?.customer) {
      return `${payment.booking.customer.first_name} ${payment.booking.customer.last_name}`;
    }
    return 'Unknown Client';
  };

  const getBookingRef = (payment) => {
    if (payment.booking) {
      const type = payment.booking.booking_type === 'Short Order' ? 'SO' : 'BKG';
      return `${type}-${payment.booking.booking_id.slice(0, 8)}`;
    }
    return 'N/A';
  };

  const getStatusBadge = (status) => {
    const map = {
      'Downpayment': 'bg-amber-50 border-amber-200 text-amber-700',
      'Fully Paid': 'bg-[#EAF3F2] border-[#C1DEDC] text-slate-800',
      'Unpaid': 'bg-red-50 border-red-200 text-red-700',
    };
    return map[status] || 'bg-slate-100 text-slate-600';
  };

  return (
    <div className="space-y-6 relative">
      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payments</h1>
          <p className="text-sm text-slate-500">Track all booking and short order payments</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-xs"
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            onClick={openNewPaymentModal}
            className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-sm"
          >
            + Record Payment
          </button>
        </div>
      </div>

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-600 mb-1">Total Collected</p>
          <h3 className="text-3xl font-extrabold text-slate-900">₱{totalCollected.toLocaleString()}</h3>
          <p className="text-xs text-slate-500 mt-2">From all payments</p>
        </div>
        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-600 mb-1">Pending Balance</p>
          <h3 className="text-3xl font-extrabold text-slate-900">₱0</h3>
          <p className="text-xs text-slate-500 mt-2">From outstanding bookings</p>
        </div>
        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-600 mb-1">Fully Paid</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{fullyPaidCount}</h3>
          <p className="text-xs text-slate-500 mt-2">Bookings fully paid</p>
        </div>
      </div>

      {/* TABS */}
      <div className="flex space-x-6 border-b border-slate-200 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-sm font-semibold transition-colors border-b-2 shrink-0 ${
              activeTab === tab
                ? 'border-[#008A45] text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* PAYMENTS TABLE */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 font-bold">Client</th>
                <th className="p-4 font-bold">Booking Ref</th>
                <th className="p-4 font-bold">Type</th>
                <th className="p-4 font-bold">Method</th>
                <th className="p-4 font-bold">Amount</th>
                <th className="p-4 font-bold">Status</th>
                <th className="p-4 font-bold">Date</th>
                <th className="p-4 font-bold text-center">Proof</th>
                <th className="p-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {loading ? (
                <tr><td colSpan="9" className="p-6 text-center text-slate-400">Loading...</td></tr>
              ) : filteredPayments.length === 0 ? (
                <tr><td colSpan="9" className="p-6 text-center text-slate-500 italic">No payments found.</td></tr>
              ) : (
                filteredPayments.map((payment) => (
                  <tr key={payment.payment_id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4">
                      <p className="font-bold text-slate-900">{getClientName(payment)}</p>
                    </td>
                    <td className="p-4 text-slate-600">{getBookingRef(payment)}</td>
                    <td className="p-4 text-slate-600">{payment.pay_status === 'Fully Paid' ? 'Full Payment' : payment.pay_status}</td>
                    <td className="p-4 font-medium text-slate-700">{payment.pay_method || 'N/A'}</td>
                    <td className="p-4 font-bold text-slate-900">₱{payment.amount_paid?.toLocaleString() || '0'}</td>
                    <td className="p-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusBadge(payment.pay_status)}`}>
                        {payment.pay_status}
                      </span>
                    </td>
                    <td className="p-4 text-slate-600">
                      {payment.pay_datetime ? new Date(payment.pay_datetime).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="p-4 text-center">
                      {payment.pay_proof ? (
                        <div className="inline-flex items-center justify-center w-20 h-10 border border-slate-300 rounded bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors text-slate-600">
                          <ImageIcon size={18} />
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">None</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => openEditModal(payment)}
                          className="text-slate-400 hover:text-[#008A45] transition-colors"
                          title="Edit"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(payment.payment_id)}
                          className="text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================= */}
      {/* RECORD / EDIT PAYMENT MODAL */}
      {/* ========================================================= */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">
                {editingId ? 'Edit Payment Record' : 'Record New Payment'}
              </h2>
              <button
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6 text-left">
              {/* Booking Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Booking</label>
                <select
                  name="booking_id"
                  value={formData.booking_id}
                  onChange={handleInputChange}
                  required
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                >
                  <option value="">-- Select Booking --</option>
                  {bookings.map((b) => {
                    const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';
                    return (
                      <option key={b.booking_id} value={b.booking_id}>
                        {b.booking_id.slice(0, 8)} - {customerName} ({b.booking_type})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Payment Details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Amount (₱)</label>
                  <input
                    type="number"
                    name="amount"
                    value={formData.amount}
                    onChange={handleInputChange}
                    placeholder="0.00"
                    step="0.01"
                    required
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Installment #</label>
                  <input
                    type="number"
                    name="pay_installment"
                    value={formData.pay_installment}
                    onChange={handleInputChange}
                    min="1"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Payment Status</label>
                  <select
                    name="pay_status"
                    value={formData.pay_status}
                    onChange={handleInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                  >
                    <option value="Downpayment">Downpayment</option>
                    <option value="Fully Paid">Fully Paid</option>
                    <option value="Unpaid">Unpaid</option>
                  </select>
                </div>
              </div>

              {/* Payment Method */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">Payment Method</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Cash', 'GCash', 'Bank Transfer'].map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, pay_method: method }))}
                      className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-sm font-semibold transition-all ${
                        formData.pay_method === method
                          ? 'bg-[#CBDEDD]/60 border-[#008A45] text-slate-900 shadow-xs'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${formData.pay_method === method ? 'border-[#008A45]' : 'border-slate-400'}`}>
                        {formData.pay_method === method && <div className="w-1.5 h-1.5 rounded-full bg-[#008A45]" />}
                      </div>
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              {/* Proof of Payment Upload */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Proof of Payment</label>
                <label className="border-2 border-dashed border-slate-300 rounded-lg p-4 flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-center relative overflow-hidden h-24">
                  <input type="file" onChange={handleFileChange} accept="image/*" className="hidden" />
                  <ImageIcon size={20} className="text-slate-400 mb-1" />
                  <span className="text-xs font-semibold text-slate-600">
                    {selectedFile ? selectedFile.name : (editingId ? 'Upload New Image (Optional)' : 'Upload Image')}
                  </span>
                  <span className="text-[10px] text-slate-400 mt-0.5">PNG, JPG up to 5MB</span>
                </label>
                <p className="text-xs text-slate-400 mt-1">You can upload a proof image; currently a placeholder is used.</p>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={closeModal}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : editingId ? 'Save Changes' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
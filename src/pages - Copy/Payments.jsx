// src/pages/Payments.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, Upload, X, Image as ImageIcon, Edit, Trash2, Check, DollarSign, RefreshCw, Eye } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';

export default function Payments() {
  const { showConfirm } = useConfirm();
  // --- STATE ---
  const [payments, setPayments] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const tabs = ['All', 'Downpayment', 'Full Payment'];

  // --- MODAL STATE ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  // --- SEARCH STATE for dropdown ---
  const [bookingSearchTerm, setBookingSearchTerm] = useState('');

  // --- SUMMARY STATE ---
  const [totalCollected, setTotalCollected] = useState(0);
  const [pendingBalance, setPendingBalance] = useState(0);
  const [fullyPaidCount, setFullyPaidCount] = useState(0);

  const initialFormState = {
    booking_id: '',
    amount: '',
    pay_method: 'Cash',
    pay_status: 'Downpayment',
    pay_proof: 'placeholder.png',
  };

  const [formData, setFormData] = useState(initialFormState);

  // --- Helper: Log technical error and show user-friendly toast ---
  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // --- Helper: Get full public URL for proof images ---
  const getProofUrl = (proofUrl) => {
    if (!proofUrl || proofUrl === 'placeholder.png' || proofUrl === 'refund_placeholder.png') {
      return null;
    }
    // If it's a relative path to storage, get the public URL
    if (proofUrl.startsWith('payments/')) {
      const { data } = supabase.storage.from('images').getPublicUrl(proofUrl);
      return data.publicUrl;
    }
    // If it's already a full URL, return it as-is
    if (proofUrl.startsWith('http://') || proofUrl.startsWith('https://')) {
      return proofUrl;
    }
    // If it's just a filename, construct the path
    if (!proofUrl.includes('/')) {
      const { data } = supabase.storage.from('images').getPublicUrl(`payments/${proofUrl}`);
      return data.publicUrl;
    }
    return proofUrl;
  };

  // --- FETCH DATA ---
  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch payments with booking details
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

      // 2. Fetch bookings (approved/pending, not completed/rejected) for dropdown
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('booking')
        .select(`
          booking_id,
          booking_type,
          customer:customer_id (first_name, last_name),
          total_amount,
          venue,
          event_datetime,
          booking_status
        `)
        .not('booking_status', 'in', '("Completed","Rejected")')
        .order('event_datetime');

      if (bookingsError) throw bookingsError;
      setBookings(bookingsData || []);

      // 3. Compute summary statistics
      const collected = paymentsData
        .filter(p => p.pay_status === 'Fully Paid' || p.pay_status === 'Downpayment')
        .reduce((sum, p) => sum + (p.amount_paid || 0), 0);
      setTotalCollected(collected);

      const bookingTotals = {};
      paymentsData.forEach(p => {
        if (p.booking_id) {
          if (!bookingTotals[p.booking_id]) bookingTotals[p.booking_id] = 0;
          bookingTotals[p.booking_id] += p.amount_paid || 0;
        }
      });
      let fullyPaid = 0;
      bookingsData.forEach(b => {
        const paid = bookingTotals[b.booking_id] || 0;
        if (paid >= (b.total_amount || 0)) fullyPaid++;
      });
      setFullyPaidCount(fullyPaid);

      let pending = 0;
      bookingsData.forEach(b => {
        const paid = bookingTotals[b.booking_id] || 0;
        const remaining = (b.total_amount || 0) - paid;
        if (remaining > 0) pending += remaining;
      });
      setPendingBalance(pending);

    } catch (error) {
      handleError(error, 'Unable to load payments. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- FILTER LOGIC ---
  const filteredPayments = payments.filter(p => {
    if (activeTab === 'All') return true;
    if (activeTab === 'Downpayment') return p.pay_status === 'Downpayment';
    if (activeTab === 'Full Payment') return p.pay_status === 'Fully Paid';
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
      pay_method: 'Cash',
      pay_status: 'Downpayment',
      pay_proof: 'placeholder.png',
    });
    setSelectedFile(null);
    setBookingSearchTerm('');
    setIsModalOpen(true);
  };

  const openEditModal = (payment) => {
    setEditingId(payment.payment_id);
    setFormData({
      booking_id: payment.booking_id,
      amount: payment.amount_paid?.toString() || '',
      pay_method: payment.pay_method || 'Cash',
      pay_status: payment.pay_status || 'Downpayment',
      pay_proof: payment.pay_proof || 'placeholder.png',
    });
    setSelectedFile(null);
    setBookingSearchTerm('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData(initialFormState);
    setSelectedFile(null);
    setBookingSearchTerm('');
    setIsSubmitting(false);
    setUploading(false);
  };

  // --- Get selected booking details and remaining balance ---
  const selectedBooking = bookings.find(b => b.booking_id === formData.booking_id);
  const getRemainingBalance = (bookingId) => {
    if (!bookingId) return 0;
    const booking = bookings.find(b => b.booking_id === bookingId);
    if (!booking) return 0;
    const paid = payments
      .filter(p => p.booking_id === bookingId)
      .reduce((sum, p) => sum + (p.amount_paid || 0), 0);
    return Math.max(0, (booking.total_amount || 0) - paid);
  };
  const remainingBalanceForSelected = getRemainingBalance(formData.booking_id);

  // --- Filter bookings for dropdown based on search term ---
 const filteredBookings = bookings.filter(b => {
  // Always include the currently selected booking (needed for editing)
  if (formData.booking_id && b.booking_id === formData.booking_id) return true;

  // 1. Compute remaining balance
  const paid = payments
    .filter(p => p.booking_id === b.booking_id)
    .reduce((sum, p) => sum + (p.amount_paid || 0), 0);
  const remaining = Math.max(0, (b.total_amount || 0) - paid);

  // 2. Hide fully paid bookings
  if (remaining <= 0) return false;

  // 3. For pending bookings, hide if they already have a downpayment
  if (b.booking_status === 'Pending') {
    const hasDownpayment = payments.some(
      p => p.booking_id === b.booking_id && p.pay_status === 'Downpayment'
    );
    if (hasDownpayment) return false;
  }

  // 4. Apply search filter (if any)
  if (bookingSearchTerm) {
    const search = bookingSearchTerm.toLowerCase();
    const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}`.toLowerCase() : '';
    const id = b.booking_id.toLowerCase();
    return customerName.includes(search) || id.includes(search);
  }

  return true;
});

  // --- CRUD (with file upload) ---
 // src/pages/Payments.jsx
// ... (all imports and state remain the same)

const handleSubmit = async (e) => {
  e.preventDefault();
  setIsSubmitting(true);

  // --- 1. Validate required fields ---
  if (!formData.booking_id) {
    toast.error('Please select a booking.');
    setIsSubmitting(false);
    return;
  }

  const amount = parseFloat(formData.amount) || 0;
  if (amount <= 0) {
    toast.error('Amount must be greater than zero.');
    setIsSubmitting(false);
    return;
  }

  if (!formData.pay_method) {
    toast.error('Please select a payment method.');
    setIsSubmitting(false);
    return;
  }

  if (!formData.pay_status) {
    toast.error('Please select a payment status.');
    setIsSubmitting(false);
    return;
  }

  // --- 2. Get the selected booking details ---
  const selectedBooking = bookings.find(b => b.booking_id === formData.booking_id);
  if (!selectedBooking) {
    toast.error('Selected booking not found.');
    setIsSubmitting(false);
    return;
  }

  // --- 3. Calculate current paid amount and remaining balance ---
  const paid = payments
    .filter(p => p.booking_id === formData.booking_id)
    .reduce((sum, p) => sum + (p.amount_paid || 0), 0);
  const totalAmount = selectedBooking.total_amount || 0;
  const remainingBalance = Math.max(0, totalAmount - paid);

  // --- 4. Check if booking is already fully paid ---
  if (remainingBalance <= 0) {
    toast.error('This booking is already fully paid. No additional payments are allowed.');
    setIsSubmitting(false);
    return;
  }

  // --- 5. Validate amount does not exceed remaining balance ---
  if (amount > remainingBalance) {
    toast.error(`Amount exceeds remaining balance of ₱${remainingBalance.toLocaleString()}.`);
    setIsSubmitting(false);
    return;
  }

  // --- 6. Determine the final payment status (may be changed by user confirmation) ---
  let finalPayStatus = formData.pay_status;
  const status = selectedBooking.booking_status || 'Pending';

  // --- 7. Check booking status and payment rules ---
  if (status === 'Pending') {
    const hasDownpayment = payments.some(
      p => p.booking_id === formData.booking_id && p.pay_status === 'Downpayment'
    );
    if (hasDownpayment) {
      toast.error('This booking already has a downpayment. Wait for approval before recording more payments.');
      setIsSubmitting(false);
      return;
    }
    if (formData.pay_status !== 'Downpayment') {
      toast.error('Pending bookings can only receive downpayments. Please approve the booking first for full payment.');
      setIsSubmitting(false);
      return;
    }
  }

  // --- 8. For approved bookings: handle "Fully Paid" conversion ---
  if (status === 'Approved' || status === 'Completed') {
    // If user selected "Fully Paid", amount must equal remaining balance
    if (formData.pay_status === 'Fully Paid' && amount < remainingBalance) {
      toast.error(`To mark as fully paid, the amount must equal the remaining balance of ₱${remainingBalance.toLocaleString()}.`);
      setIsSubmitting(false);
      return;
    }

    // Use tolerance to avoid floating-point issues
    const isAmountEqualRemaining = Math.abs(amount - remainingBalance) < 0.01;

    // If amount equals remaining balance and user selected "Downpayment", ask if they want to convert to Fully Paid
    if (formData.pay_status === 'Downpayment' && isAmountEqualRemaining) {
      const confirm = await showConfirm({
        title: 'Full Payment?',
        message: `This payment amount (₱${amount.toLocaleString()}) equals the remaining balance. Would you like to mark it as Fully Paid instead?`,
        confirmLabel: 'Yes, Mark Fully Paid',
        cancelLabel: 'No, Keep as Downpayment',
        confirmVariant: 'success',
      });
      if (confirm) {
        finalPayStatus = 'Fully Paid';
        setFormData(prev => ({ ...prev, pay_status: 'Fully Paid' }));
        // Continue to submit (no return)
      }
    }
  }

  // --- 9. Proceed with payment recording ---
  try {
    let proofUrl = formData.pay_proof;

    if (selectedFile) {
      setUploading(true);
      try {
        const fileExt = selectedFile.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `payments/${fileName}`;
        const { error: uploadError } = await supabase.storage
          .from('images')
          .upload(filePath, selectedFile);
        if (uploadError) throw uploadError;
        const { data: publicUrlData } = supabase.storage
          .from('images')
          .getPublicUrl(filePath);
        proofUrl = publicUrlData.publicUrl;
      } catch (err) {
        console.error('Upload error:', err);
        toast.error('Failed to upload proof image. Please try again.');
        setUploading(false);
        setIsSubmitting(false);
        return;
      }
      setUploading(false);
    }

    const payload = {
      booking_id: formData.booking_id,
      amount_paid: amount,
      pay_method: formData.pay_method,
      pay_status: finalPayStatus,
      pay_datetime: new Date().toISOString(),
      pay_proof: proofUrl || 'placeholder.png',
      customer_id: selectedBooking?.customer?.customer_id || null,
    };

    if (editingId) {
      const { error } = await supabase
        .from('payment')
        .update(payload)
        .eq('payment_id', editingId);
      if (error) throw error;
      toast.success('Payment updated successfully!');
    } else {
      const { error } = await supabase
        .from('payment')
        .insert([payload]);
      if (error) throw error;
      toast.success('Payment recorded successfully!');
    }

    closeModal();
    fetchData();
  } catch (error) {
    handleError(error, 'Failed to save payment.');
  } finally {
    setIsSubmitting(false);
    setUploading(false);
  }
};

  const handleDelete = async (id) => {
    const confirmed = await showConfirm({
      title: 'Delete Payment?',
      message: 'Are you sure you want to permanently delete this payment record? This action cannot be undone.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('payment')
        .delete()
        .eq('payment_id', id);
      if (error) throw error;
      toast.success('Payment deleted.');
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to delete payment.');
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

  // Helper to render proof image with proper Supabase URL
  const renderProof = (proofUrl) => {
    if (!proofUrl || proofUrl === 'placeholder.png' || proofUrl === 'refund_placeholder.png') {
      return <span className="text-xs text-slate-400 italic">None</span>;
    }

    // Get the full public URL
    const fullUrl = getProofUrl(proofUrl);
    if (!fullUrl) {
      return <span className="text-xs text-slate-400 italic">Invalid</span>;
    }

    return (
      <button
        onClick={() => window.open(fullUrl, '_blank')}
        className="inline-flex items-center justify-center w-10 h-10 border border-slate-300 rounded bg-slate-50 hover:bg-slate-100 hover:shadow-md transition-all cursor-pointer"
        title="Click to view proof"
      >
        <img
          src={fullUrl}
          alt="Payment proof"
          className="w-full h-full object-cover rounded"
          onError={(e) => {
            e.target.style.display = 'none';
            const parent = e.target.parentElement;
            const fallback = document.createElement('div');
            fallback.className = 'w-full h-full flex items-center justify-center text-slate-400';
            fallback.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>`;
            parent.appendChild(fallback);
          }}
        />
      </button>
    );
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
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
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
          <h3 className="text-3xl font-extrabold text-slate-900">₱{pendingBalance.toLocaleString()}</h3>
          <p className="text-xs text-slate-500 mt-2">Outstanding from all bookings</p>
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
                <tr><td colSpan="9" className="p-6 text-center text-slate-400">Loading payments...</td></tr>
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
                      {renderProof(payment.pay_proof)}
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

            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6 text-left">
              {/* Booking Selection with Search */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Booking</label>
                
                {/* Search input for bookings */}
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    placeholder="Search by customer name or booking ID..."
                    value={bookingSearchTerm}
                    onChange={(e) => setBookingSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                  />
                </div>

                <select
                  name="booking_id"
                  value={formData.booking_id}
                  onChange={handleInputChange}
                  required
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                >
                  <option value="">-- Select Booking --</option>
                  {filteredBookings.map((b) => {
                    const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';
                    return (
                      <option key={b.booking_id} value={b.booking_id}>
                        {b.booking_id.slice(0, 8)} - {customerName} ({b.booking_type})
                      </option>
                    );
                  })}
                  {filteredBookings.length === 0 && bookings.length > 0 && (
                    <option disabled>No matching bookings found</option>
                  )}
                </select>
                <p className="text-xs text-slate-400 mt-1">Type to filter the list above</p>
              </div>

              {/* Booking Details Preview */}
              {selectedBooking && (
                <div className="bg-[#F8F9FA] border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
                  <h4 className="font-bold text-slate-900 text-sm mb-2">Booking Details</h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <span className="text-slate-600 font-medium">Customer:</span>
                    <span className="text-slate-900 font-semibold">
                      {selectedBooking.customer ? `${selectedBooking.customer.first_name} ${selectedBooking.customer.last_name}` : 'Unknown'}
                    </span>
                    <span className="text-slate-600 font-medium">Type:</span>
                    <span className="text-slate-900 font-semibold">{selectedBooking.booking_type || 'N/A'}</span>
                    <span className="text-slate-600 font-medium">Venue:</span>
                    <span className="text-slate-900 font-semibold">{selectedBooking.venue || 'N/A'}</span>
                    <span className="text-slate-600 font-medium">Event Date:</span>
                    <span className="text-slate-900 font-semibold">
                      {selectedBooking.event_datetime ? new Date(selectedBooking.event_datetime).toLocaleString() : 'N/A'}
                    </span>
                    <span className="text-slate-600 font-medium">Total Amount:</span>
                    <span className="text-slate-900 font-bold text-[#008A45]">
                      ₱{selectedBooking.total_amount?.toLocaleString() || '0'}
                    </span>
                    <span className="text-slate-600 font-medium">Status:</span>
                    <span className="text-slate-900 font-semibold capitalize">{selectedBooking.booking_status || 'N/A'}</span>
                  </div>
                  {/* Show existing payments summary */}
                  {payments.filter(p => p.booking_id === selectedBooking.booking_id).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-slate-500">
                      <span className="font-medium">Existing payments: </span>
                      {payments.filter(p => p.booking_id === selectedBooking.booking_id).map((p, idx) => (
                        <span key={idx} className="ml-1">
                          ₱{p.amount_paid.toLocaleString()} ({p.pay_status}) {idx < payments.filter(p2 => p2.booking_id === selectedBooking.booking_id).length - 1 ? '•' : ''}
                        </span>
                      ))}
                      <br />
                      <span className="font-medium">Remaining balance: </span>
                      <span className="font-bold text-amber-700">₱{remainingBalanceForSelected.toLocaleString()}</span>
                    </div>
                  )}
                  {payments.filter(p => p.booking_id === selectedBooking.booking_id).length === 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-slate-500">
                      <span className="font-medium">Remaining balance: </span>
                      <span className="font-bold text-amber-700">₱{remainingBalanceForSelected.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}

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
                  {selectedBooking && (
                    <p className="text-xs text-slate-400 mt-1">Max: ₱{remainingBalanceForSelected.toLocaleString()}</p>
                  )}
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Payment Status</label>
                  <select
                    name="pay_status"
                    value={formData.pay_status}
                    onChange={handleInputChange}
                    required
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                  >
                    <option value="Downpayment">Downpayment</option>
                    <option value="Fully Paid">Fully Paid</option>
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
                <p className="text-xs text-slate-400 mt-1">Upload a proof image; will be stored in Supabase Storage.</p>
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
                  disabled={isSubmitting || uploading}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : (isSubmitting ? 'Saving...' : (editingId ? 'Save Changes' : 'Record Payment'))}
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
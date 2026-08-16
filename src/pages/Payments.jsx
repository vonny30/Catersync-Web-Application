// src/pages/Payments.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, Upload, X, Image as ImageIcon, Edit, Trash2, Check, DollarSign, RefreshCw, Eye } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { sumVerifiedPositivePayments, UNVERIFIED_PAY_STATUSES } from '../utils/payments';

export default function Payments() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();

  // --- STATE ---
  const [payments, setPayments] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All'); // 'All', 'Package', 'Short Order'
  const tabs = ['All', 'Pending Verification', 'Downpayment', 'Full Payment'];

  // --- Reject Proof modal state ---
  const [isRejectProofModalOpen, setIsRejectProofModalOpen] = useState(false);
  const [rejectProofTarget, setRejectProofTarget] = useState(null);
  const [rejectProofReason, setRejectProofReason] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

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

  // --- SUMMARY DETAIL MODAL STATE ---
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [summaryModalData, setSummaryModalData] = useState([]);
  const [summaryModalTitle, setSummaryModalTitle] = useState('');
  const [summaryModalType, setSummaryModalType] = useState(''); // 'collected', 'pending', 'fullypaid'

  // --- PAYMENT DETAIL MODAL STATE ---
  const [isPaymentDetailModalOpen, setIsPaymentDetailModalOpen] = useState(false);
  const [selectedPaymentDetail, setSelectedPaymentDetail] = useState(null);

  // --- PROOF IMAGE MODAL STATE ---
  const [isProofModalOpen, setIsProofModalOpen] = useState(false);
  const [proofModalUrl, setProofModalUrl] = useState('');

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
    if (proofUrl.startsWith('payments/')) {
      const { data } = supabase.storage.from('images').getPublicUrl(proofUrl);
      return data.publicUrl;
    }
    if (proofUrl.startsWith('http://') || proofUrl.startsWith('https://')) {
      return proofUrl;
    }
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
      // Fetch payments with booking details (including booking_status and booking_type)
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payment')
        .select(`
          *,
          booking:booking_id (
            booking_id,
            booking_type,
            booking_status,
            customer:customer_id (first_name, last_name),
            venue,
            event_datetime,
            total_amount
          )
        `)
        .neq('pay_status', 'Pending')
        .order('pay_datetime', { ascending: false });

      if (paymentsError) throw paymentsError;
      setPayments(paymentsData || []);

      // Fetch active bookings (exclude Rejected, Cancelled, Completed for pending balance)
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('booking')
        .select(`
          booking_id,
          booking_type,
          booking_status,
          customer:customer_id (first_name, last_name, customer_id),
          total_amount,
          venue,
          event_datetime
        `)
        .not('booking_status', 'in', '("Completed","Rejected","Cancelled")')
        .order('event_datetime');

      if (bookingsError) throw bookingsError;
      setBookings(bookingsData || []);

      // Calculate Net Collected: only from bookings that are NOT Rejected or
      // Cancelled, and only counting verified funds (Pending Verification /
      // Proof Rejected rows aren't real money in hand yet).
      const activePayments = paymentsData.filter(p => {
        const status = p.booking?.booking_status;
        return status !== 'Rejected' && status !== 'Cancelled';
      });
      const verifiedActivePayments = activePayments.filter(p => !UNVERIFIED_PAY_STATUSES.includes(p.pay_status));
      const collected = verifiedActivePayments.reduce((sum, p) => sum + (p.amount_paid || 0), 0);
      setTotalCollected(collected);

      // For fully paid count and pending balance, we consider only active bookings
      const bookingTotals = {};
      verifiedActivePayments.forEach(p => {
        if (p.booking_id) {
          if (!bookingTotals[p.booking_id]) bookingTotals[p.booking_id] = 0;
          bookingTotals[p.booking_id] += p.amount_paid || 0;
        }
      });
      let fullyPaid = 0;
      bookingsData.forEach(b => {
        const paid = bookingTotals[b.booking_id] || 0;
        if (paid >= (b.total_amount || 0) && paid > 0) fullyPaid++;
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

  // --- FILTER LOGIC (status + type) ---
  const filteredPayments = payments.filter(p => {
    // Status filter
    if (activeTab === 'All') {
      // pass
    } else if (activeTab === 'Pending Verification') {
      if (p.pay_status !== 'Pending Verification') return false;
    } else if (activeTab === 'Downpayment') {
      if (p.pay_status !== 'Downpayment') return false;
    } else if (activeTab === 'Full Payment') {
      if (p.pay_status !== 'Fully Paid') return false;
    }

    // Type filter
    if (typeFilter !== 'All') {
      const bookingType = p.booking?.booking_type;
      if (typeFilter === 'Package' && bookingType !== 'Package') return false;
      if (typeFilter === 'Short Order' && bookingType !== 'Short Order') return false;
    }
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
      .filter(p => p.booking_id === bookingId && !UNVERIFIED_PAY_STATUSES.includes(p.pay_status))
      .reduce((sum, p) => sum + (p.amount_paid || 0), 0);
    return Math.max(0, (booking.total_amount || 0) - paid);
  };
  const remainingBalanceForSelected = getRemainingBalance(formData.booking_id);

  const getTotalPaidForBooking = (bookingId) => {
    if (!bookingId) return 0;
    return sumVerifiedPositivePayments(payments.filter(p => p.booking_id === bookingId));
  };
  const totalPaidForSelected = getTotalPaidForBooking(formData.booking_id);
  const isFirstPaymentForSelected = totalPaidForSelected === 0;

  // --- Filter bookings for dropdown (only those with remaining balance > 0) ---
  const filteredBookings = bookings.filter(b => {
    if (formData.booking_id && b.booking_id === formData.booking_id) return true;

    const remaining = getRemainingBalance(b.booking_id);
    if (remaining <= 0) return false;

    if (bookingSearchTerm) {
      const search = bookingSearchTerm.toLowerCase();
      const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}`.toLowerCase() : '';
      const id = b.booking_id.toLowerCase();
      return customerName.includes(search) || id.includes(search);
    }
    return true;
  });

  // --- CRUD (with file upload) ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

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

    let isProofRequired = true;
    if (editingId) {
      const currentProof = formData.pay_proof;
      if (currentProof && currentProof !== 'placeholder.png' && currentProof !== 'refund_placeholder.png') {
        isProofRequired = false;
      }
    }
    if (isProofRequired && !selectedFile) {
      toast.error('Please upload a proof of payment image.');
      setIsSubmitting(false);
      return;
    }

    const selectedBooking = bookings.find(b => b.booking_id === formData.booking_id);
    if (!selectedBooking) {
      toast.error('Selected booking not found.');
      setIsSubmitting(false);
      return;
    }

    // Excludes the row being edited (otherwise its old amount double-counts
    // against itself, corrupting the remaining-balance math below) and
    // excludes unverified rows (Pending Verification / Proof Rejected
    // aren't real collected funds), matching sumVerifiedPositivePayments
    // usage everywhere else in the app.
    const paid = sumVerifiedPositivePayments(
      payments.filter(p => p.booking_id === formData.booking_id && p.payment_id !== editingId)
    );
    const totalAmount = selectedBooking.total_amount || 0;
    const remainingBalance = Math.max(0, totalAmount - paid);
    const isFirstPayment = paid === 0;

    if (remainingBalance <= 0) {
      toast.error('This booking is already fully paid. No additional payments are allowed.');
      setIsSubmitting(false);
      return;
    }

    if (amount > remainingBalance) {
      toast.error(`Amount exceeds remaining balance of ₱${remainingBalance.toLocaleString()}.`);
      setIsSubmitting(false);
      return;
    }

    const status = formData.pay_status;

    if (status === 'Downpayment' && isFirstPayment) {
      const requiredMin = totalAmount * 0.5;
      if (amount < requiredMin) {
        toast.error(`First payment (Downpayment) must be at least 50% of total (₱${requiredMin.toLocaleString()}).`);
        setIsSubmitting(false);
        return;
      }
    } else if (status === 'Fully Paid') {
      if (isFirstPayment) {
        if (amount < totalAmount) {
          toast.error(`First payment marked as Fully Paid must equal the full total amount (₱${totalAmount.toLocaleString()}).`);
          setIsSubmitting(false);
          return;
        }
      } else {
        if (amount < remainingBalance) {
          toast.error(`To mark as Fully Paid, the amount must equal the remaining balance of ₱${remainingBalance.toLocaleString()}.`);
          setIsSubmitting(false);
          return;
        }
      }
    }

    let finalPayStatus = status;
    const isAmountEqualRemaining = Math.abs(amount - remainingBalance) < 0.01;
    const isAmountEqualTotal = Math.abs(amount - totalAmount) < 0.01;

    // First payment equals full total → ask to mark as Fully Paid
    if (status === 'Downpayment' && isFirstPayment && isAmountEqualTotal) {
      const confirm = await showConfirm({
        title: 'Full Payment?',
        message: `This is the first payment and the amount (₱${amount.toLocaleString()}) equals the full total. Would you like to mark it as Fully Paid instead?`,
        confirmLabel: 'Yes, Mark Fully Paid',
        cancelLabel: 'No, Keep as Downpayment',
        confirmVariant: 'success',
      });
      if (confirm) {
        finalPayStatus = 'Fully Paid';
        setFormData(prev => ({ ...prev, pay_status: 'Fully Paid' }));
      }
    }

    // Subsequent payment equals remaining balance → ask to mark as Fully Paid
    if (status === 'Downpayment' && isAmountEqualRemaining && !isFirstPayment) {
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
      }
    }

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

  // --- Verify / Reject a customer-submitted payment proof ---
  const handleVerifyPaymentRow = async (payment) => {
    const totalAmount = payment.booking?.total_amount || 0;
    const alreadyVerified = sumVerifiedPositivePayments(
      payments.filter(p => p.booking_id === payment.booking_id && p.payment_id !== payment.payment_id)
    );
    const remainingBeforeThis = Math.max(0, totalAmount - alreadyVerified);
    const finalStatus = payment.amount_paid >= remainingBeforeThis ? 'Fully Paid' : 'Downpayment';

    const confirmed = await showConfirm({
      title: 'Verify Payment?',
      message: `Confirm this payment of ₱${(payment.amount_paid || 0).toLocaleString()} is legitimate? It will be marked as "${finalStatus}".`,
      confirmLabel: 'Yes, Verify',
      cancelLabel: 'Cancel',
      confirmVariant: 'success',
    });
    if (!confirmed) return;

    setIsVerifying(true);
    try {
      const { error } = await supabase
        .from('payment')
        .update({ pay_status: finalStatus })
        .eq('payment_id', payment.payment_id);
      if (error) throw error;
      toast.success(`Payment verified and marked as ${finalStatus}.`);
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to verify payment.');
    } finally {
      setIsVerifying(false);
    }
  };

  const openRejectProofModal = (payment) => {
    setRejectProofTarget(payment);
    setRejectProofReason('');
    setIsRejectProofModalOpen(true);
  };

  const handleRejectProofConfirm = async () => {
    if (!rejectProofTarget) return;
    if (!rejectProofReason.trim()) {
      toast.error('Please provide a reason so the customer knows what to fix.');
      return;
    }
    setIsVerifying(true);
    try {
      const { error } = await supabase
        .from('payment')
        .update({ pay_status: 'Proof Rejected', remarks: rejectProofReason.trim() })
        .eq('payment_id', rejectProofTarget.payment_id);
      if (error) throw error;
      setIsRejectProofModalOpen(false);
      toast.success('Payment proof rejected. The customer will need to resubmit.');
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to reject payment proof.');
    } finally {
      setIsVerifying(false);
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
      'Refunded': 'bg-red-100 border-red-200 text-red-700',
      'Pending': 'bg-slate-100 border-slate-200 text-slate-500',
      'Pending Verification': 'bg-blue-50 border-blue-200 text-blue-700',
      'Proof Rejected': 'bg-red-50 border-red-200 text-red-700',
    };
    return map[status] || 'bg-slate-100 text-slate-600';
  };

  // --- Status badge (no warning icon) ---
  const getOrderStatusBadge = (status) => {
    const map = {
      'Pending': 'bg-amber-100 text-amber-800 border-amber-200',
      'Approved': 'bg-green-100 text-green-800 border-green-200',
      'Confirmed': 'bg-emerald-100 text-emerald-800 border-emerald-200',
      'Completed': 'bg-blue-100 text-blue-800 border-blue-200',
      'Rejected': 'bg-red-100 text-red-800 border-red-200',
      'Cancelled': 'bg-slate-200 text-slate-700 border-slate-300',
    };
    return map[status] || 'bg-slate-100 text-slate-600 border-slate-200';
  };

  // --- Updated renderProof: opens modal instead of new tab ---
  const renderProof = (proofUrl) => {
    if (!proofUrl || proofUrl === 'placeholder.png' || proofUrl === 'refund_placeholder.png') {
      return <span className="text-xs text-slate-400 italic">None</span>;
    }

    const fullUrl = getProofUrl(proofUrl);
    if (!fullUrl) {
      return <span className="text-xs text-slate-400 italic">Invalid</span>;
    }

    return (
      <button
        onClick={() => {
          setProofModalUrl(fullUrl);
          setIsProofModalOpen(true);
        }}
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

  const isRefund = (payment) => payment.amount_paid < 0;

  // --- Row click handler: open payment detail modal ---
  const handleRowClick = (payment) => {
    setSelectedPaymentDetail(payment);
    setIsPaymentDetailModalOpen(true);
  };

  // --- Summary Card Click Handlers ---

  // 1. Net Collected – shows all positive payments from active (non-rejected/cancelled) orders
  const handleCollectedClick = () => {
    const data = payments
      .filter(p => {
        const status = p.booking?.booking_status;
        return p.amount_paid > 0 && status !== 'Rejected' && status !== 'Cancelled';
      })
      .map(p => ({
        ...p,
        clientName: getClientName(p),
        bookingRef: getBookingRef(p),
      }));
    setSummaryModalData(data);
    setSummaryModalTitle('Net Collected – Detailed Payments (active orders only)');
    setSummaryModalType('collected');
    setIsSummaryModalOpen(true);
  };

  // 2. Pending Balance – shows orders with outstanding amount
  const handlePendingClick = () => {
    const data = bookings.map(b => {
      const paid = payments
        .filter(p => p.booking_id === b.booking_id && !UNVERIFIED_PAY_STATUSES.includes(p.pay_status))
        .reduce((sum, p) => sum + (p.amount_paid || 0), 0);
      const remaining = Math.max(0, (b.total_amount || 0) - paid);
      return {
        ...b,
        remaining,
        paid,
        clientName: b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown',
        bookingRef: b.booking_type === 'Short Order' ? `SO-${b.booking_id.slice(0, 8)}` : `BKG-${b.booking_id.slice(0, 8)}`,
      };
    }).filter(b => b.remaining > 0);
    setSummaryModalData(data);
    setSummaryModalTitle('Pending Balance – Orders with Outstanding Amount');
    setSummaryModalType('pending');
    setIsSummaryModalOpen(true);
  };

  // 3. ✅ FIXED Fully Paid – shows payments from fully paid orders (positive payments only)
  const handleFullyPaidClick = () => {
    // 3a. Determine which booking IDs are fully paid (active, not rejected/cancelled)
    const fullyPaidBookingIds = bookings
      .filter(b => {
        const paid = payments
          .filter(p => p.booking_id === b.booking_id && !UNVERIFIED_PAY_STATUSES.includes(p.pay_status))
          .reduce((sum, p) => sum + (p.amount_paid || 0), 0);
        return paid >= (b.total_amount || 0) && paid > 0;
      })
      .map(b => b.booking_id);

    // 3b. Filter payments to those belonging to fully paid bookings (positive amounts only)
    const data = payments
      .filter(p => fullyPaidBookingIds.includes(p.booking_id) && p.amount_paid > 0)
      .map(p => ({
        ...p,
        clientName: getClientName(p),
        bookingRef: getBookingRef(p),
      }));

    setSummaryModalData(data);
    setSummaryModalTitle('Fully Paid Orders – Payment Details');
    setSummaryModalType('fullypaid');
    setIsSummaryModalOpen(true);
  };

  const closeSummaryModal = () => {
    setIsSummaryModalOpen(false);
    setSummaryModalData([]);
  };

  const handleSummaryRowClick = (item) => {
    if (item.booking_id) {
      const type = item.booking_type || (item.booking?.booking_type);
      const id = item.booking_id || item.booking?.booking_id;
      if (type === 'Short Order') {
        navigate(`/app/orders/${id}`);
      } else {
        navigate(`/app/bookings/${id}`);
      }
    }
  };

  const closePaymentDetailModal = () => {
    setIsPaymentDetailModalOpen(false);
    setSelectedPaymentDetail(null);
  };

  // --- RENDER ---
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
        <button
          onClick={handleCollectedClick}
          className="bg-white border border-slate-200 border-l-4 border-l-[#008A45] rounded-2xl p-5 text-left shadow-sm hover:shadow-md transition-all cursor-pointer group"
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Net Collected</p>
          <h3 className="text-3xl font-extrabold text-slate-900">₱{totalCollected.toLocaleString()}</h3>
          <p className="text-xs text-slate-500 mt-2">After refunds (active orders only)</p>
          <span className="text-[10px] text-slate-400 group-hover:text-[#008A45] transition-colors">Click to view details</span>
        </button>
        <button
          onClick={handlePendingClick}
          className="bg-white border border-slate-200 border-l-4 border-l-amber-500 rounded-2xl p-5 text-left shadow-sm hover:shadow-md transition-all cursor-pointer group"
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Pending Balance</p>
          <h3 className="text-3xl font-extrabold text-slate-900">₱{pendingBalance.toLocaleString()}</h3>
          <p className="text-xs text-slate-500 mt-2">Outstanding from active orders</p>
          <span className="text-[10px] text-slate-400 group-hover:text-amber-600 transition-colors">Click to view details</span>
        </button>
        <button
          onClick={handleFullyPaidClick}
          className="bg-white border border-slate-200 border-l-4 border-l-emerald-500 rounded-2xl p-5 text-left shadow-sm hover:shadow-md transition-all cursor-pointer group"
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Fully Paid</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{fullyPaidCount}</h3>
          <p className="text-xs text-slate-500 mt-2">Active orders fully paid</p>
          <span className="text-[10px] text-slate-400 group-hover:text-emerald-600 transition-colors">Click to view details</span>
        </button>
      </div>

      {/* TABS + TYPE FILTER */}
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 pb-2">
        <div className="flex space-x-6 overflow-x-auto flex-1">
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
        <div className="flex items-center gap-2 pb-1">
          <span className="text-xs font-medium text-slate-500">Type:</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
          >
            <option value="All">All</option>
            <option value="Package">Packages</option>
            <option value="Short Order">Short Orders</option>
          </select>
        </div>
      </div>

      {/* PAYMENTS TABLE */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 font-bold">Client</th>
                <th className="p-4 font-bold">Order Ref</th>
                <th className="p-4 font-bold">Status</th>
                <th className="p-4 font-bold">Type</th>
                <th className="p-4 font-bold">Method</th>
                <th className="p-4 font-bold">Amount</th>
                <th className="p-4 font-bold">Payment Status</th>
                <th className="p-4 font-bold">Date</th>
                <th className="p-4 font-bold text-center">Proof</th>
                <th className="p-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {loading ? (
                <tr><td colSpan="10" className="p-6 text-center text-slate-400">Loading payments...</td></tr>
              ) : filteredPayments.length === 0 ? (
                <tr><td colSpan="10" className="p-6 text-center text-slate-500 italic">No payments found.</td></tr>
              ) : (
                filteredPayments.map((payment) => {
                  const refund = isRefund(payment);
                  const orderStatus = payment.booking?.booking_status || 'Unknown';
                  const isCancelledOrRejected = orderStatus === 'Rejected' || orderStatus === 'Cancelled';
                  return (
                    <tr
                      key={payment.payment_id}
                      className={`hover:bg-slate-50 transition-colors cursor-pointer ${refund ? 'bg-red-50/50' : ''} ${isCancelledOrRejected ? 'opacity-70' : ''}`}
                      onClick={() => handleRowClick(payment)}
                    >
                      <td className="p-4">
                        <p className="font-bold text-slate-900">{getClientName(payment)}</p>
                      </td>
                      <td className="p-4 text-slate-600">{getBookingRef(payment)}</td>
                      <td className="p-4">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${getOrderStatusBadge(orderStatus)}`}>
                          {orderStatus}
                        </span>
                      </td>
                      <td className="p-4 text-slate-600">
                        {payment.booking?.booking_type === 'Short Order' ? 'Short Order' : 'Package'}
                      </td>
                      <td className="p-4 font-medium text-slate-700">{payment.pay_method || 'N/A'}</td>
                      <td className={`p-4 font-bold ${refund ? 'text-red-600' : 'text-slate-900'}`}>
                        {refund ? '-' : ''}₱{Math.abs(payment.amount_paid || 0).toLocaleString()}
                      </td>
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusBadge(payment.pay_status)}`}>
                          {payment.pay_status === 'Refunded' ? 'Refunded' : payment.pay_status}
                        </span>
                      </td>
                      <td className="p-4 text-slate-600">
                        {payment.pay_datetime ? new Date(payment.pay_datetime).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="p-4 text-center">
                        {renderProof(payment.pay_proof)}
                      </td>
                      <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-3">
                          {payment.pay_status === 'Pending Verification' && (
                            <>
                              <button
                                onClick={() => handleVerifyPaymentRow(payment)}
                                disabled={isVerifying}
                                className="text-green-600 hover:text-green-800 transition-colors disabled:opacity-50"
                                title="Verify Payment"
                              >
                                <Check size={16} />
                              </button>
                              <button
                                onClick={() => openRejectProofModal(payment)}
                                disabled={isVerifying}
                                className="text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                                title="Reject Proof"
                              >
                                <X size={16} />
                              </button>
                            </>
                          )}
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== PROOF IMAGE MODAL ===== */}
      {isProofModalOpen && proofModalUrl && createPortal(
        <div
          className="fixed inset-0 z-[99999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsProofModalOpen(false)}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">Payment Proof</h3>
              <button
                onClick={() => setIsProofModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 flex items-center justify-center max-h-[75vh] overflow-auto">
              <img src={proofModalUrl} alt="Payment proof" className="max-w-full max-h-full object-contain rounded-lg" />
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
              <button
                onClick={() => setIsProofModalOpen(false)}
                className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
              >
                Close
              </button>
              <a
                href={proofModalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors"
              >
                Open in New Tab
              </a>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== PAYMENT DETAIL MODAL ===== */}
      {isPaymentDetailModalOpen && selectedPaymentDetail && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0 bg-white">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Payment Details</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {getBookingRef(selectedPaymentDetail)} – {getClientName(selectedPaymentDetail)}
                </p>
              </div>
              <button
                onClick={closePaymentDetailModal}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Payment summary */}
              <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div>
                  <span className="font-medium text-slate-500">Amount</span>
                  <p className={`font-bold text-lg ${selectedPaymentDetail.amount_paid < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                    {selectedPaymentDetail.amount_paid < 0 ? '-' : ''}₱{Math.abs(selectedPaymentDetail.amount_paid).toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="font-medium text-slate-500">Payment Status</span>
                  <p>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusBadge(selectedPaymentDetail.pay_status)}`}>
                      {selectedPaymentDetail.pay_status}
                    </span>
                  </p>
                </div>
                <div>
                  <span className="font-medium text-slate-500">Method</span>
                  <p className="font-semibold">{selectedPaymentDetail.pay_method || 'N/A'}</p>
                </div>
                <div>
                  <span className="font-medium text-slate-500">Date</span>
                  <p>{selectedPaymentDetail.pay_datetime ? new Date(selectedPaymentDetail.pay_datetime).toLocaleString() : 'N/A'}</p>
                </div>
                <div className="col-span-2">
                  <span className="font-medium text-slate-500">Order</span>
                  <p>
                    <span className="font-semibold">{getBookingRef(selectedPaymentDetail)}</span>
                    <span className={`ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${getOrderStatusBadge(selectedPaymentDetail.booking?.booking_status)}`}>
                      {selectedPaymentDetail.booking?.booking_status || 'Unknown'}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">({selectedPaymentDetail.booking?.booking_type || 'Package'})</span>
                  </p>
                  <p className="text-xs text-slate-500">{selectedPaymentDetail.booking?.venue || 'No venue'}</p>
                  <p className="text-xs text-slate-500">Event: {selectedPaymentDetail.booking?.event_datetime ? new Date(selectedPaymentDetail.booking.event_datetime).toLocaleString() : 'N/A'}</p>
                </div>
                {selectedPaymentDetail.remarks && (
                  <div className="col-span-2">
                    <span className="font-medium text-slate-500">Remarks</span>
                    <p className="text-slate-700">{selectedPaymentDetail.remarks}</p>
                  </div>
                )}
                <div className="col-span-2">
                  <span className="font-medium text-slate-500">Proof of Payment</span>
                  <div className="mt-2">
                    {renderProof(selectedPaymentDetail.pay_proof)}
                  </div>
                </div>
              </div>

              {/* Other payments for the same order */}
              {selectedPaymentDetail.booking_id && (
                <div>
                  <h3 className="text-sm font-bold text-slate-900 mb-3">Other payments for this order</h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {payments
                      .filter(p => p.booking_id === selectedPaymentDetail.booking_id && p.payment_id !== selectedPaymentDetail.payment_id)
                      .map(p => (
                        <div key={p.payment_id} className="flex justify-between items-center bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm">
                          <span>{p.pay_status} – ₱{Math.abs(p.amount_paid).toLocaleString()}</span>
                          <span className="text-slate-500">{p.pay_datetime ? new Date(p.pay_datetime).toLocaleDateString() : ''}</span>
                        </div>
                      ))}
                    {payments.filter(p => p.booking_id === selectedPaymentDetail.booking_id && p.payment_id !== selectedPaymentDetail.payment_id).length === 0 && (
                      <p className="text-xs text-slate-400 italic">No other payments recorded.</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200 shrink-0">
              <button
                onClick={closePaymentDetailModal}
                className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== SUMMARY DETAIL MODAL ===== */}
      {isSummaryModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0 bg-white">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{summaryModalTitle}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{summaryModalData.length} record(s) found</p>
              </div>
              <button
                onClick={closeSummaryModal}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {summaryModalData.length === 0 ? (
                <div className="text-center py-10 text-slate-500">No records found.</div>
              ) : (
                <>
                  {/* Collected & Fully Paid – show payment list */}
                  {(summaryModalType === 'collected' || summaryModalType === 'fullypaid') && (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                          <th className="p-3">Order Ref</th>
                          <th className="p-3">Client</th>
                          <th className="p-3">Type</th>
                          <th className="p-3">Method</th>
                          <th className="p-3 text-right">Amount</th>
                          <th className="p-3">Payment Status</th>
                          <th className="p-3">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {summaryModalData.map((item, idx) => (
                          <tr
                            key={idx}
                            className="hover:bg-slate-50 transition-colors cursor-pointer"
                            onClick={() => handleSummaryRowClick(item)}
                          >
                            <td className="p-3 font-mono text-xs font-semibold text-slate-800">
                              {item.bookingRef || getBookingRef(item)}
                            </td>
                            <td className="p-3 font-medium text-slate-900">
                              {item.clientName || getClientName(item)}
                            </td>
                            <td className="p-3">
                              {item.booking_type === 'Short Order' ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-purple-100 text-purple-700 border border-purple-200 rounded-full">Short Order</span>
                              ) : (
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-100 text-blue-700 border border-blue-200 rounded-full">Package</span>
                              )}
                            </td>
                            <td className="p-3">{item.pay_method || 'N/A'}</td>
                            <td className="p-3 text-right font-bold text-emerald-600">
                              ₱{(item.amount_paid || 0).toLocaleString()}
                            </td>
                            <td className="p-3">
                              <span className={`px-2 py-1 rounded-full text-xs font-bold ${getStatusBadge(item.pay_status)}`}>
                                {item.pay_status}
                              </span>
                            </td>
                            <td className="p-3 text-slate-600 text-xs">
                              {item.pay_datetime ? new Date(item.pay_datetime).toLocaleDateString() : 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                        <tr>
                          <td colSpan="4" className="p-3 text-right font-bold text-slate-700">Total:</td>
                          <td className="p-3 text-right font-bold text-emerald-700">
                            ₱{summaryModalData.reduce((sum, p) => sum + (p.amount_paid || 0), 0).toLocaleString()}
                          </td>
                          <td colSpan="2"></td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {/* Pending Balance – show order list with remaining */}
                  {summaryModalType === 'pending' && (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                          <th className="p-3">Order Ref</th>
                          <th className="p-3">Client</th>
                          <th className="p-3">Type</th>
                          <th className="p-3 text-right">Total</th>
                          <th className="p-3 text-right">Paid</th>
                          <th className="p-3 text-right">Remaining</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {summaryModalData.map((item, idx) => (
                          <tr
                            key={idx}
                            className="hover:bg-slate-50 transition-colors cursor-pointer"
                            onClick={() => handleSummaryRowClick(item)}
                          >
                            <td className="p-3 font-mono text-xs font-semibold text-slate-800">
                              {item.bookingRef || getBookingRef(item)}
                            </td>
                            <td className="p-3 font-medium text-slate-900">{item.clientName}</td>
                            <td className="p-3">
                              {item.booking_type === 'Short Order' ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-purple-100 text-purple-700 border border-purple-200 rounded-full">Short Order</span>
                              ) : (
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-100 text-blue-700 border border-blue-200 rounded-full">Package</span>
                              )}
                            </td>
                            <td className="p-3 text-right font-semibold">₱{(item.total_amount || 0).toLocaleString()}</td>
                            <td className="p-3 text-right font-semibold text-emerald-600">₱{(item.paid || 0).toLocaleString()}</td>
                            <td className="p-3 text-right font-bold text-red-600">₱{(item.remaining || 0).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                        <tr>
                          <td colSpan="5" className="p-3 text-right font-bold text-slate-700">Total Pending:</td>
                          <td className="p-3 text-right font-bold text-red-600">
                            ₱{summaryModalData.reduce((sum, b) => sum + (b.remaining || 0), 0).toLocaleString()}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200 shrink-0">
              <button
                onClick={closeSummaryModal}
                className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================= */}
      {/* RECORD / EDIT PAYMENT MODAL (unchanged, with Downpayment/Fully Paid only) */}
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
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    placeholder="Search by customer name or order ID..."
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
                  <option value="">-- Select Order --</option>
                  {filteredBookings.map((b) => {
                    const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';
                    const paid = payments
                      .filter(p => p.booking_id === b.booking_id)
                      .reduce((sum, p) => sum + (p.amount_paid || 0), 0);
                    const remaining = Math.max(0, (b.total_amount || 0) - paid);
                    return (
                      <option key={b.booking_id} value={b.booking_id}>
                        {b.booking_id.slice(0, 8)} - {customerName} ({b.booking_type}) - Remaining: ₱{remaining.toLocaleString()}
                      </option>
                    );
                  })}
                  {filteredBookings.length === 0 && bookings.length > 0 && (
                    <option disabled>No matching orders found</option>
                  )}
                </select>
                <p className="text-xs text-slate-400 mt-1">Type to filter the list above</p>
              </div>

              {/* Booking Details Preview */}
              {selectedBooking && (
                <div className="bg-[#F8F9FA] border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
                  <h4 className="font-bold text-slate-900 text-sm mb-2">Order Details</h4>
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
                  {payments.filter(p => p.booking_id === selectedBooking.booking_id).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-slate-500">
                      <span className="font-medium">Existing payments: </span>
                      {payments.filter(p => p.booking_id === selectedBooking.booking_id).map((p, idx) => (
                        <span key={idx} className="ml-1">
                          {p.amount_paid < 0 ? '-' : ''}₱{Math.abs(p.amount_paid).toLocaleString()} ({p.pay_status}) {idx < payments.filter(p2 => p2.booking_id === selectedBooking.booking_id).length - 1 ? '•' : ''}
                        </span>
                      ))}
                      <br />
                      <span className="font-medium">Remaining balance: </span>
                      <span className="font-bold text-amber-700">₱{remainingBalanceForSelected.toLocaleString()}</span>
                      <br />
                      <span className="font-medium">First Payment? </span>
                      <span className="font-semibold">{isFirstPaymentForSelected ? '✅ Yes' : 'No'}</span>
                    </div>
                  )}
                  {payments.filter(p => p.booking_id === selectedBooking.booking_id).length === 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-slate-500">
                      <span className="font-medium">Remaining balance: </span>
                      <span className="font-bold text-amber-700">₱{remainingBalanceForSelected.toLocaleString()}</span>
                      <br />
                      <span className="font-medium">First Payment? </span>
                      <span className="font-semibold">✅ Yes</span>
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
                  {selectedBooking && (() => {
                    const total = selectedBooking.total_amount || 0;
                    const isFirst = isFirstPaymentForSelected;
                    const status = formData.pay_status;
                    let hint = '';
                    if (isFirst) {
                      if (status === 'Downpayment') {
                        const minRequired = total * 0.5;
                        hint = `First payment: Downpayment must be at least 50% of total (₱${minRequired.toLocaleString()}).`;
                      } else if (status === 'Fully Paid') {
                        hint = `First payment: Fully Paid must equal total amount (₱${total.toLocaleString()}).`;
                      }
                    } else {
                      if (status === 'Fully Paid') {
                        hint = `Remaining balance to close: ₱${remainingBalanceForSelected.toLocaleString()}.`;
                      } else {
                        hint = `You can enter any amount up to the remaining balance.`;
                      }
                    }
                    return hint ? (
                      <p className="text-xs text-blue-600 mt-1 font-medium">{hint}</p>
                    ) : null;
                  })()}
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
                  <p className="text-xs text-slate-400 mt-1">Status cannot be edited after recording</p>
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
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Proof of Payment
                  {!editingId && <span className="text-red-500 ml-1">*</span>}
                  {editingId && formData.pay_proof && formData.pay_proof !== 'placeholder.png' && formData.pay_proof !== 'refund_placeholder.png' && (
                    <span className="text-xs text-slate-400 ml-2">(optional – replace existing)</span>
                  )}
                  {editingId && (!formData.pay_proof || formData.pay_proof === 'placeholder.png' || formData.pay_proof === 'refund_placeholder.png') && (
                    <span className="text-red-500 ml-1">*</span>
                  )}
                </label>
                <label className="border-2 border-dashed border-slate-300 rounded-lg p-4 flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-center relative overflow-hidden h-24">
                  <input type="file" onChange={handleFileChange} accept="image/*" className="hidden" />
                  <ImageIcon size={20} className="text-slate-400 mb-1" />
                  <span className="text-xs font-semibold text-slate-600">
                    {selectedFile ? selectedFile.name : (editingId ? 'Upload New Image (Optional)' : 'Upload Image')}
                  </span>
                  <span className="text-[10px] text-slate-400 mt-0.5">PNG, JPG up to 5MB</span>
                </label>
                <p className="text-xs text-slate-400 mt-1">
                  {editingId && formData.pay_proof && formData.pay_proof !== 'placeholder.png' && formData.pay_proof !== 'refund_placeholder.png'
                    ? 'Leave blank to keep existing proof.'
                    : 'Upload a proof image; will be stored in Supabase Storage.'}
                </p>
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

      {/* ===== REJECT PAYMENT PROOF MODAL ===== */}
      {isRejectProofModalOpen && rejectProofTarget && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Reject Payment Proof</h2>
              <button onClick={() => setIsRejectProofModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-left">
              <p className="text-sm text-slate-600">
                Rejecting the proof for the ₱{(rejectProofTarget.amount_paid || 0).toLocaleString()} payment submitted by {getClientName(rejectProofTarget)}. They'll need to resubmit — let them know why.
              </p>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Reason *</label>
                <textarea
                  value={rejectProofReason}
                  onChange={(e) => setRejectProofReason(e.target.value)}
                  rows="3"
                  placeholder="e.g. Proof image is unreadable, amount doesn't match, wrong receiving account..."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-red-400 resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsRejectProofModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRejectProofConfirm}
                  disabled={isVerifying}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isVerifying ? 'Rejecting...' : 'Reject Proof'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
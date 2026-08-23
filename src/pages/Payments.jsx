// src/pages/Payments.jsx
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, Upload, X, Image as ImageIcon, Check, DollarSign, RefreshCw, Eye, Filter, LayoutGrid, RotateCcw, ExternalLink, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePasswordConfirm } from '../contexts/PasswordConfirmContext';
import { sumVerifiedPositivePayments, UNVERIFIED_PAY_STATUSES, describePaymentKind } from '../utils/payments';
import { getPaymentsReceived } from '../utils/reportMetrics';
import { fetchAllRows } from '../utils/fetchAllRows';
import DateRangeFilter from './Reports/DateRangeFilter';
import { getRangeBounds, isWithinRange } from './Reports/helpers';

export default function Payments() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const { requestPasswordConfirm } = usePasswordConfirm();

  // --- STATE ---
  const [payments, setPayments] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All'); // 'All', 'Package', 'Short Order'
  const [methodFilter, setMethodFilter] = useState('All'); // 'All', 'Cash', 'GCash', 'Bank Transfer'
  // A refund is a kind of TRANSACTION, not a way of paying — money going out
  // rather than a method of it coming in. It used to sit in the Method list
  // beside Cash and GCash, which is the miscategorisation the panel raised.
  // It's also not a payment at all, so it gets its own tab rather than being
  // filterable in-and-out of the payments list.
  const [mainTab, setMainTab] = useState('Payments'); // 'Payments' | 'Refunds'
  const [tableSearchTerm, setTableSearchTerm] = useState(''); // filters the payments table by client name / booking ref

  // --- TABLE SORT — click a column header to sort; click again to flip
  // direction. null = default order (newest first, as fetched). ---
  const [sortField, setSortField] = useState(null); // null | 'client' | 'date'
  const [sortDirection, setSortDirection] = useState('desc'); // 'asc' | 'desc'
  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'client' ? 'asc' : 'desc');
    }
  };

  // Status cards jump straight to the results below when clicked.
  const tableRef = useRef(null);
  const scrollToTable = () => {
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // --- DATE FILTER STATE ---
  const [datePreset, setDatePreset] = useState('All Time');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // --- Reject Proof modal state ---
  const [isRejectProofModalOpen, setIsRejectProofModalOpen] = useState(false);
  const [rejectProofTarget, setRejectProofTarget] = useState(null);
  const [rejectProofReason, setRejectProofReason] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  // --- Verify Payment modal state — mobile submissions arrive as a generic
  // direct transfer, so verifying is also where the manager records
  // whether it was actually GCash or Bank Transfer. ---
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState(null);
  const [verifyMethod, setVerifyMethod] = useState('GCash');

  // --- MODAL STATE ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Field-level errors — highlights exactly which input is blocking
  // submission (red border + inline message) instead of only a toast.
  const [amountError, setAmountError] = useState('');
  const [fileError, setFileError] = useState('');

  // --- SEARCH STATE for dropdown ---
  const [bookingSearchTerm, setBookingSearchTerm] = useState('');
  const [showBookingList, setShowBookingList] = useState(false);

  // --- SUMMARY STATE ---
  const [pendingBalance, setPendingBalance] = useState(0);
  const [fullyPaidCount, setFullyPaidCount] = useState(0);

  // --- SUMMARY DETAIL MODAL STATE ---
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [summaryModalData, setSummaryModalData] = useState([]);
  const [summaryModalTitle, setSummaryModalTitle] = useState('');
  const [summaryModalType, setSummaryModalType] = useState(''); // 'collected', 'pending', 'fullypaid'
  const [summarySearchTerm, setSummarySearchTerm] = useState('');
  const [summaryTypeFilter, setSummaryTypeFilter] = useState('All'); // 'All' | 'Package' | 'Short Order'
  const [summaryMethodFilter, setSummaryMethodFilter] = useState('All'); // 'All' | 'Cash' | 'GCash' | 'Bank Transfer' | 'Refund' — only meaningful for Collected/Fully Paid (payment-level records); Pending is booking-level and has no pay_method
  const [summaryDatePreset, setSummaryDatePreset] = useState('All Time');
  const [summaryDateCustomStart, setSummaryDateCustomStart] = useState('');
  const [summaryDateCustomEnd, setSummaryDateCustomEnd] = useState('');

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
      // Paged — see utils/fetchAllRows. Unbounded, this stopped at the
      // PostgREST 1000-row cap with no error, so every card on this page was
      // computed from a truncated set once the table grew past it. That is
      // the defect behind "the Fully Paid count doesn't match the records".
      //
      // pay_datetime is NOT unique, so it cannot page safely on its own;
      // payment_id is chained after it purely as a tiebreaker. The visible
      // order is unchanged — newest first is also this table's default
      // display order, since sortedPayments falls back to fetch order until
      // the manager picks a column.
      const paymentsData = await fetchAllRows(() => supabase
        .from('payment')
        .select(`
          *,
          booking:booking_id (
            booking_id,
            booking_number,
            booking_type,
            booking_status,
            customer:customer_id (first_name, last_name),
            venue,
            event_datetime,
            total_amount
          )
        `)
        .neq('pay_status', 'Pending')
        .order('pay_datetime', { ascending: false })
        .order('payment_id', { ascending: true }), 'payment');

      setPayments(paymentsData || []);

      // Fetch bookings a payment can legitimately be recorded against —
      // the same statuses the Details pages allow "Record Payment" for.
      // Completed is included on purpose: a Completed booking can still
      // have a balance owed (see "Balance Remaining"), and that balance
      // needs to be payable from here too, not just from its own Details
      // page. Rejected/Cancelled are excluded — no new money should be
      // recorded against those.
      // Paged for the same reason, with booking_id as the tiebreaker since
      // event_datetime is not unique either.
      const bookingsData = await fetchAllRows(() => supabase
        .from('booking')
        .select(`
          booking_id,
          booking_number,
          booking_type,
          booking_status,
          customer:customer_id (first_name, last_name, customer_id),
          total_amount,
          venue,
          event_datetime
        `)
        .in('booking_status', ['Approved', 'Confirmed', 'Completed'])
        .order('event_datetime')
        .order('booking_id', { ascending: true }), 'booking');

      setBookings(bookingsData || []);

      // Payments Received now follows the page's own date filter and is derived
      // further down (see the `received` memo) — a flow figure has to describe
      // the period the table is showing, or the card and the rows underneath it
      // are talking about different months.
      //
      // The two figures below are different in kind: an outstanding balance and
      // a count of settled records are positions as at now, not flows over a
      // period, so they are correctly not date-filtered.
      const verifiedActivePayments = paymentsData.filter(p => {
        const status = p.booking?.booking_status;
        return status !== 'Rejected' && status !== 'Cancelled'
          && !UNVERIFIED_PAY_STATUSES.includes(p.pay_status);
      });

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

  // --- FILTER LOGIC (search + type + method + date, independent of status) ---
  const { start: dateRangeStart, end: dateRangeEnd } = getRangeBounds(datePreset, customStart, customEnd);
  const activePaymentFilterCount = [!!tableSearchTerm, typeFilter !== 'All', methodFilter !== 'All', datePreset !== 'All Time'].filter(Boolean).length;
  const typeAndDateFiltered = payments.filter(p => {
    if (mainTab === 'Refunds' && (p.amount_paid || 0) >= 0) return false;
    if (mainTab === 'Payments' && (p.amount_paid || 0) < 0) return false;
    if (tableSearchTerm) {
      const search = tableSearchTerm.toLowerCase();
      const clientName = p.booking?.customer ? `${p.booking.customer.first_name} ${p.booking.customer.last_name}`.toLowerCase() : '';
      const ref = bookingRefFor(p.booking).toLowerCase();
      if (!clientName.includes(search) && !ref.includes(search)) return false;
    }
    if (typeFilter !== 'All') {
      const bookingType = p.booking?.booking_type;
      if (typeFilter === 'Package' && bookingType !== 'Package') return false;
      if (typeFilter === 'Short Order' && bookingType !== 'Short Order') return false;
    }
    if (methodFilter !== 'All' && p.pay_method !== methodFilter) return false;
    if (datePreset !== 'All Time' && !isWithinRange(p.pay_datetime, dateRangeStart, dateRangeEnd)) return false;
    return true;
  });

  // --- STATUS CARDS (replace the old tabs) — each card's count/amount is
  // computed from the type+date filtered set, so the numbers stay accurate
  // as those other filters change, and clicking one filters the table by
  // that status. ---
  const statusTabs = [
    { key: 'All', label: 'All Payments', description: 'Every payment record, any status', match: () => true },
    { key: 'Pending Verification', label: 'Pending Verification', description: 'Submitted from mobile, awaiting review', match: (p) => p.pay_status === 'Pending Verification' },
    { key: 'Downpayment', label: 'Downpayment', description: 'Partial payments recorded so far', match: (p) => p.pay_status === 'Downpayment' },
    { key: 'Full Payment', label: 'Fully Paid', description: 'Records paid in full', match: (p) => p.pay_status === 'Fully Paid' },
  ];
  const statusStats = statusTabs.map(t => {
    const rows = typeAndDateFiltered.filter(t.match);
    return {
      ...t,
      count: rows.length,
      amount: rows.reduce((sum, p) => sum + Math.max(0, p.amount_paid || 0), 0),
    };
  });

  const filteredPayments = typeAndDateFiltered.filter(
    statusTabs.find(t => t.key === activeTab)?.match || (() => true)
  );

  // --- GROUP BY BOOKING — one row per booking/short order instead of one
  // row per payment record. A booking can carry several payments (deposit,
  // top-up, the one that clears it), and listing each separately made the
  // table read as a list of transactions rather than a list of orders. The
  // row shows the most recent payment's amount/status/date/proof; clicking
  // it opens the existing Payment Details modal, which already lists every
  // other payment on that booking. Only meaningful for the Payments tab —
  // Refunds are each their own event and stay listed individually below. ---
  const groupedPayments = mainTab === 'Payments'
    ? Object.values(
        filteredPayments.reduce((groups, p) => {
          const key = p.booking_id || p.payment_id;
          if (!groups[key]) groups[key] = { bookingId: p.booking_id, booking: p.booking, entries: [] };
          groups[key].entries.push(p);
          return groups;
        }, {})
      ).map(group => {
        const entries = [...group.entries].sort((a, b) => new Date(b.pay_datetime || 0) - new Date(a.pay_datetime || 0));
        const latest = entries[0];
        return {
          ...group,
          entries,
          latest,
          count: entries.length,
          totalPaid: sumVerifiedPositivePayments(entries),
        };
      })
    : [];

  // Payments Received, over whatever period (and type/method) the page is
  // currently filtered to — the same shared definition Dashboard and Reports
  // use. Deriving it from typeAndDateFiltered rather than the raw list is what
  // makes the card describe the table beneath it; the status cards above
  // already work this way.
  const received = getPaymentsReceived(typeAndDateFiltered);

  // --- HANDLERS ---
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (name === 'amount') setAmountError('');
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setFileError('');
    }
  };

  const openNewPaymentModal = () => {
    setFormData({
      booking_id: '',
      amount: '',
      pay_method: 'Cash',
      pay_status: 'Downpayment',
      pay_proof: 'placeholder.png',
    });
    setSelectedFile(null);
    setBookingSearchTerm('');
    setShowBookingList(false);
    setAmountError('');
    setFileError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setFormData(initialFormState);
    setSelectedFile(null);
    setBookingSearchTerm('');
    setShowBookingList(false);
    setAmountError('');
    setFileError('');
    setIsSubmitting(false);
    setUploading(false);
  };

  // Prefer the human-readable booking_number — falls back to a shortened
  // UUID only for old records that predate that column being populated.
  function bookingRefFor(b) {
    if (!b) return 'N/A';
    if (b.booking_number) return b.booking_number;
    const type = b.booking_type === 'Short Order' ? 'SO' : 'BKG';
    return `${type}-${b.booking_id.slice(0, 8)}`;
  }

  // --- Get selected booking details and remaining balance ---
  const selectedBooking = bookings.find(b => b.booking_id === formData.booking_id);
  // Excludes the row being edited — otherwise its own amount is still
  // counted as "already paid," making the displayed remaining balance/Max
  // hint understate how much room is actually available (the real submit
  // validation already excludes it correctly; this keeps the on-screen
  // hints consistent with what will actually be accepted).
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
      const ref = bookingRefFor(b).toLowerCase();
      return customerName.includes(search) || ref.includes(search);
    }
    return true;
  });

  const selectBooking = (b) => {
    setFormData(prev => ({ ...prev, booking_id: b.booking_id }));
    const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';
    setBookingSearchTerm(`${bookingRefFor(b)} — ${customerName}`);
    setShowBookingList(false);
  };

  // --- CRUD (with file upload) ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setAmountError('');
    setFileError('');

    if (!formData.booking_id) {
      toast.error('Please select a booking.');
      setIsSubmitting(false);
      return;
    }

    const amount = parseFloat(formData.amount) || 0;
    if (amount <= 0) {
      toast.error('Amount must be greater than zero.');
      setAmountError('Amount must be greater than zero.');
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

    if (!selectedFile) {
      toast.error('Please upload a proof of payment image.');
      setFileError('Proof of payment is required.');
      setIsSubmitting(false);
      return;
    }

    const selectedBooking = bookings.find(b => b.booking_id === formData.booking_id);
    if (!selectedBooking) {
      toast.error('Selected booking not found.');
      setIsSubmitting(false);
      return;
    }

    // Excludes unverified rows (Pending Verification / Proof Rejected aren't
    // real collected funds), matching sumVerifiedPositivePayments usage
    // everywhere else in the app.
    const paid = sumVerifiedPositivePayments(
      payments.filter(p => p.booking_id === formData.booking_id)
    );
    const totalAmount = selectedBooking.total_amount || 0;
    const remainingBalance = Math.max(0, totalAmount - paid);
    const isFirstPayment = paid === 0;

    if (remainingBalance <= 0) {
      toast.error("This booking is fully paid — there's no balance left to record against.");
      setIsSubmitting(false);
      return;
    }

    if (amount > remainingBalance) {
      const msg = `Amount exceeds remaining balance of ₱${remainingBalance.toLocaleString()}.`;
      toast.error(msg);
      setAmountError(msg);
      setIsSubmitting(false);
      return;
    }

    const status = formData.pay_status;

    if (status === 'Downpayment' && isFirstPayment) {
      const requiredMin = totalAmount * 0.5;
      if (amount < requiredMin) {
        const msg = `First payment (Downpayment) must be at least 50% of total (₱${requiredMin.toLocaleString()}).`;
        toast.error(msg);
        setAmountError(msg);
        setIsSubmitting(false);
        return;
      }
    } else if (status === 'Fully Paid') {
      if (isFirstPayment) {
        if (amount < totalAmount) {
          const msg = `First payment marked as Fully Paid must equal the full total amount (₱${totalAmount.toLocaleString()}).`;
          toast.error(msg);
          setAmountError(msg);
          setIsSubmitting(false);
          return;
        }
      } else {
        if (amount < remainingBalance) {
          const msg = `To mark as Fully Paid, the amount must equal the remaining balance of ₱${remainingBalance.toLocaleString()}.`;
          toast.error(msg);
          setAmountError(msg);
          setIsSubmitting(false);
          return;
        }
      }
    }

    let finalPayStatus = status;
    const isAmountEqualRemaining = Math.abs(amount - remainingBalance) < 0.01;
    const isAmountEqualTotal = Math.abs(amount - totalAmount) < 0.01;

    // An amount that fully covers the balance IS a full payment, regardless
    // of which status was selected in the form — matches the same
    // auto-correct behavior in usePaymentHandlers.js (used by the
    // Bookings/Short Orders detail pages), so this page's own separate
    // record-payment form doesn't diverge and leave the ledger saying
    // "Downpayment" on a booking that's actually paid off.
    let autoMarkedFullyPaid = false;
    if (status === 'Downpayment' && isFirstPayment && isAmountEqualTotal) {
      finalPayStatus = 'Fully Paid';
      autoMarkedFullyPaid = true;
    } else if (status === 'Downpayment' && !isFirstPayment && isAmountEqualRemaining) {
      finalPayStatus = 'Fully Paid';
      autoMarkedFullyPaid = true;
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

      const autoMarkedMessage = `marked as Fully Paid — the amount entered covers the full ${isFirstPayment ? 'total' : 'remaining'} balance.`;

      const { error } = await supabase
        .from('payment')
        .insert([payload]);
      if (error) throw error;
      toast.success(autoMarkedFullyPaid ? `Payment recorded and ${autoMarkedMessage}` : 'Payment recorded.');

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
  const KNOWN_PAY_METHODS = ['Cash', 'GCash', 'Bank Transfer'];

  const openVerifyModal = (payment) => {
    setVerifyTarget(payment);
    setVerifyMethod(KNOWN_PAY_METHODS.includes(payment.pay_method) ? payment.pay_method : 'GCash');
    setIsVerifyModalOpen(true);
  };

  const handleVerifyConfirm = async () => {
    if (!verifyTarget) return;
    const payment = verifyTarget;
    const totalAmount = payment.booking?.total_amount || 0;
    const alreadyVerified = sumVerifiedPositivePayments(
      payments.filter(p => p.booking_id === payment.booking_id && p.payment_id !== payment.payment_id)
    );
    const remainingBeforeThis = Math.max(0, totalAmount - alreadyVerified);
    const finalStatus = payment.amount_paid >= remainingBeforeThis ? 'Fully Paid' : 'Downpayment';

    // The amount itself isn't editable here (it's whatever the customer
    // submitted) — the manual Record Payment form blocks an over-balance
    // amount outright, but this flow can only warn and let the admin
    // decide, since rejecting the proof is the only other option and that
    // might not be what a genuine (if unusual) overpayment calls for.
    const overpaidBy = payment.amount_paid - remainingBeforeThis;
    if (overpaidBy > 0) {
      const proceed = await showConfirm({
        title: 'Verifying This Overpays the Booking',
        message: `This payment (₱${payment.amount_paid.toLocaleString()}) is ₱${overpaidBy.toLocaleString()} more than the ₱${remainingBeforeThis.toLocaleString()} still remaining on this booking. Verify anyway?`,
        confirmLabel: 'Yes, Verify Anyway',
        cancelLabel: 'Cancel',
        confirmVariant: 'warning',
      });
      if (!proceed) return;
    }

    // Verifying is the moment an unverified claim becomes counted money —
    // it moves the figure on every revenue card — so it takes a password,
    // the same as deleting one. Rejecting a proof deliberately does NOT,
    // because it takes nothing in. Asked last, after the overpay warning
    // above, so the manager is never made to re-type a password for an
    // action a later check would have stopped anyway.
    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm your password',
      message: 'Verifying a payment records it as money received. Re-enter your password to continue.',
    });
    if (!passwordOk) return;

    setIsVerifying(true);
    try {
      const { error } = await supabase
        .from('payment')
        .update({ pay_status: finalStatus, pay_method: verifyMethod })
        .eq('payment_id', payment.payment_id);
      if (error) throw error;
      setIsVerifyModalOpen(false);
      toast.success(`Payment verified as ${verifyMethod} and marked "${finalStatus}".`);
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

  // Payments can never be edited or deleted (per panel review): once a
  // payment exists it already went through manual recording or mobile proof
  // verification, so there is no legitimate reason to alter or remove it
  // after the fact — a refund is recorded as its own new entry instead.

  const getClientName = (payment) => {
    if (payment.booking?.customer) {
      return `${payment.booking.customer.first_name} ${payment.booking.customer.last_name}`;
    }
    return 'Unknown customer';
  };

  const getBookingRef = (payment) => bookingRefFor(payment.booking);

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

  const sortedPayments = sortField ? [...filteredPayments].sort((a, b) => {
    let result = 0;
    if (sortField === 'client') {
      result = getClientName(a).localeCompare(getClientName(b));
    } else if (sortField === 'date') {
      result = new Date(a.pay_datetime || 0) - new Date(b.pay_datetime || 0);
    }
    return sortDirection === 'asc' ? result : -result;
  }) : filteredPayments;

  // Same sort, applied to the one-row-per-booking view.
  const sortedGroupedPayments = sortField ? [...groupedPayments].sort((a, b) => {
    let result = 0;
    if (sortField === 'client') {
      result = getClientName(a.latest).localeCompare(getClientName(b.latest));
    } else if (sortField === 'date') {
      result = new Date(a.latest.pay_datetime || 0) - new Date(b.latest.pay_datetime || 0);
    }
    return sortDirection === 'asc' ? result : -result;
  }) : groupedPayments;

  const renderSortHeader = (field, label) => (
    <button
      onClick={() => toggleSort(field)}
      className="flex items-center gap-1 font-bold hover:text-[#008A45] transition-colors cursor-pointer"
    >
      {label}
      {sortField === field ? (
        sortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
      ) : (
        <ArrowUpDown size={12} className="text-slate-400" />
      )}
    </button>
  );

  // --- Summary modal search/filter — every card that opens a record list
  // gets the same search-by-client/ref + type filter, matching the main
  // table's filter pattern above. ---
  const { start: summaryDateRangeStart, end: summaryDateRangeEnd } = getRangeBounds(summaryDatePreset, summaryDateCustomStart, summaryDateCustomEnd);

  const filteredSummaryModalData = summaryModalData.filter(item => {
    if (summaryTypeFilter !== 'All') {
      const itemType = item.booking_type === 'Short Order' ? 'Short Order' : 'Package';
      if (itemType !== summaryTypeFilter) return false;
    }
    // Scoped to 'collected' explicitly: the control is only rendered there and
    // is reset to All on every open, but booking-shaped rows have no
    // pay_method, so a stray value here would silently empty the list.
    if (summaryModalType === 'collected' && summaryMethodFilter !== 'All' && item.pay_method !== summaryMethodFilter) return false;
    if (summaryDatePreset !== 'All Time') {
      // Collected/Fully Paid are payment rows (pay_datetime); Pending
      // Balance is a booking-level aggregate with no payment date, so it
      // filters by event date instead.
      // 'collected' rows are payments (pay_datetime); 'pending' and
      // 'fullypaid' rows are bookings, which have no pay_datetime at all —
      // filtering those on it would match nothing and silently empty the
      // modal the moment a period was picked.
      const dateField = summaryModalType === 'collected' ? item.pay_datetime : item.event_datetime;
      if (!isWithinRange(dateField, summaryDateRangeStart, summaryDateRangeEnd)) return false;
    }
    if (summarySearchTerm.trim()) {
      const term = summarySearchTerm.toLowerCase();
      const clientName = (item.clientName || getClientName(item) || '').toLowerCase();
      const ref = (item.bookingRef || getBookingRef(item) || '').toLowerCase();
      if (!clientName.includes(term) && !ref.includes(term)) return false;
    }
    return true;
  });
  const activeSummaryFilterCount = (summarySearchTerm.trim() ? 1 : 0) + (summaryTypeFilter !== 'All' ? 1 : 0) + (summaryMethodFilter !== 'All' ? 1 : 0) + (summaryDatePreset !== 'All Time' ? 1 : 0);

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

  // --- Row click handler: open payment detail modal ---
  const handleRowClick = (payment) => {
    setSelectedPaymentDetail(payment);
    setIsPaymentDetailModalOpen(true);
  };

  // --- Summary Card Click Handlers ---

  // 1. Payments Received – exactly the rows the card summed.
  //
  // Sourced from `received.activeRows`, NOT from the raw `payments` list. The
  // card became date-filtered when it moved to getPaymentsReceived, but this
  // handler kept reading the unfiltered list — so with a period selected the
  // card showed that period while the modal behind it opened on all time, and
  // the two totals disagreed by however much history existed. Taking the rows
  // straight from the same result the card rendered means they cannot drift
  // again, and refunds stay included so the modal's footer reconciles with a
  // headline that is explicitly net of them.
  const handleCollectedClick = () => {
    const data = received.activeRows
      .map(p => ({
        ...p,
        clientName: getClientName(p),
        bookingRef: getBookingRef(p),
        // p's own booking_type lives at p.booking.booking_type (nested) —
        // hoist it to the top level so the modal's Type badge (which reads
        // item.booking_type for every summary type, including the 'pending'
        // one where it IS already top-level) doesn't silently fall back to
        // "Package" for every Short Order payment.
        booking_type: p.booking?.booking_type,
      }));
    setSummaryModalData(data);
    // Name the period, since these rows are the card's period — not all time.
    setSummaryModalTitle(`Payments Received – ${datePreset === 'All Time' ? 'all time' : datePreset.toLowerCase()}`);
    setSummaryModalType('collected');
    setSummarySearchTerm('');
    setSummaryTypeFilter('All');
    setSummaryMethodFilter('All');
    setSummaryDatePreset('All Time');
    setSummaryDateCustomStart('');
    setSummaryDateCustomEnd('');
    setIsSummaryModalOpen(true);
  };

  // 2. Outstanding Balance – records with an unpaid balance
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
        bookingRef: bookingRefFor(b),
      };
    }).filter(b => b.remaining > 0);
    setSummaryModalData(data);
    setSummaryModalTitle('Outstanding Balance – bookings & orders with a balance due');
    setSummaryModalType('pending');
    setSummarySearchTerm('');
    setSummaryTypeFilter('All');
    setSummaryMethodFilter('All');
    setSummaryDatePreset('All Time');
    setSummaryDateCustomStart('');
    setSummaryDateCustomEnd('');
    setIsSummaryModalOpen(true);
  };

  // 3. ✅ FIXED Fully Paid – shows payments from fully paid orders (positive payments only)
  const handleFullyPaidClick = () => {
    // Lists the BOOKINGS the card counts — one row each — not their payments.
    //
    // The card counts fully-paid bookings while this used to list every
    // payment belonging to them, and a booking commonly has several. So a
    // card reading 5 opened onto 12 rows, which is exactly the mismatch the
    // panel reported ("the displayed number does not appear to match the
    // number of corresponding records"). Same source, same shape, so the
    // count and the list now agree by construction rather than by luck.
    const data = bookings
      .map(b => {
        const paid = payments
          .filter(p => p.booking_id === b.booking_id && !UNVERIFIED_PAY_STATUSES.includes(p.pay_status))
          .reduce((sum, p) => sum + (p.amount_paid || 0), 0);
        return {
          ...b,
          paid,
          clientName: b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown',
          bookingRef: bookingRefFor(b),
        };
      })
      .filter(b => b.paid >= (b.total_amount || 0) && b.paid > 0);

    setSummaryModalData(data);
    setSummaryModalTitle('Paid in full – bookings & orders');
    setSummaryModalType('fullypaid');
    setSummarySearchTerm('');
    setSummaryTypeFilter('All');
    setSummaryMethodFilter('All');
    setSummaryDatePreset('All Time');
    setSummaryDateCustomStart('');
    setSummaryDateCustomEnd('');
    setIsSummaryModalOpen(true);
  };

  // 4. Pending Verification – payments submitted from the mobile app that a
  // manager hasn't reviewed yet (a manually recorded payment is verified by
  // definition, so this only ever surfaces mobile submissions). Jumps
  // straight to that tab instead of opening the detail modal, since the
  // action a manager needs (Verify / Reject) already lives there.
  const handlePendingVerificationClick = () => {
    setActiveTab('Pending Verification');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeSummaryModal = () => {
    setIsSummaryModalOpen(false);
    setSummaryModalData([]);
    setSummarySearchTerm('');
    setSummaryTypeFilter('All');
    setSummaryMethodFilter('All');
    setSummaryDatePreset('All Time');
    setSummaryDateCustomStart('');
    setSummaryDateCustomEnd('');
  };

  // --- Jump to the full booking/short order detail page ---
  const goToBookingDetails = (id, type) => {
    if (!id) return;
    navigate(`/app/${type === 'Short Order' ? 'orders' : 'bookings'}/${id}`);
  };

  const handleSummaryRowClick = (item) => {
    if (item.booking_id) {
      const type = item.booking_type || (item.booking?.booking_type);
      const id = item.booking_id || item.booking?.booking_id;
      goToBookingDetails(id, type);
    }
  };

  const closePaymentDetailModal = () => {
    setIsPaymentDetailModalOpen(false);
    setSelectedPaymentDetail(null);
  };

  const pendingVerificationCount = payments.filter(p => p.pay_status === 'Pending Verification').length;

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

      {/* SUMMARY CARDS — "Awaiting Verification" only exists when there's something
          to review, so the grid drops to 3 columns then instead of leaving
          a blank fourth slot. */}
      <div className={`grid grid-cols-1 gap-6 ${pendingVerificationCount > 0 ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        {pendingVerificationCount > 0 && (
          <button
            onClick={handlePendingVerificationClick}
            className="relative bg-red-50 border-2 border-red-300 border-l-4 border-l-red-500 rounded-2xl p-5 text-left shadow-sm hover:shadow-md transition-all cursor-pointer group"
          >
            <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
            <p className="text-xs font-bold text-red-700 mb-1 uppercase tracking-wide">Awaiting Verification</p>
            <h3 className="text-3xl font-extrabold text-red-700">{pendingVerificationCount}</h3>
            <p className="text-xs text-red-600 mt-2 font-medium">Submitted from the mobile app — awaiting verification</p>
            <span className="text-[10px] text-red-500 font-semibold group-hover:text-red-700 transition-colors">Click to review now →</span>
          </button>
        )}
        <button
          onClick={handleCollectedClick}
          className="bg-white border border-slate-200 border-l-4 border-l-[#008A45] rounded-2xl p-5 text-left shadow-sm hover:shadow-md transition-all cursor-pointer group"
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Payments Received</p>
          <h3 className="text-3xl font-extrabold text-slate-900">₱{received.paymentsReceived.toLocaleString()}</h3>
          <p className="text-xs text-slate-500 mt-2">
            Net of refunds · {datePreset === 'All Time' ? 'all time' : datePreset.toLowerCase()}
          </p>
          {received.retainedFromCancellations > 0 && (
            <p className="text-[11px] text-amber-700 mt-1 font-medium">
              + ₱{received.retainedFromCancellations.toLocaleString()} retained from cancellations
            </p>
          )}
          <span className="text-[10px] text-slate-400 group-hover:text-[#008A45] transition-colors">Click to view details</span>
        </button>
        <button
          onClick={handlePendingClick}
          className="bg-white border border-slate-200 border-l-4 border-l-amber-500 rounded-2xl p-5 text-left shadow-sm hover:shadow-md transition-all cursor-pointer group"
        >
          {/* "Pending Balance" collided with the booking status called Pending:
              this figure has nothing to do with Pending bookings — it is the
              unpaid balance across every active record, whatever its status. */}
          <p className="text-xs font-semibold text-slate-600 mb-1">Outstanding Balance</p>
          <h3 className="text-3xl font-extrabold text-slate-900">₱{pendingBalance.toLocaleString()}</h3>
          <p className="text-xs text-slate-500 mt-2">Unpaid balance on active bookings &amp; orders</p>
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

      {/* MAIN TABS — Refunds are money going OUT, not a kind of payment, so
          they get their own tab instead of living in the payments list
          behind a dropdown filter. */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        {['Payments', 'Refunds'].map(tab => (
          <button
            key={tab}
            onClick={() => { setMainTab(tab); setActiveTab('All'); scrollToTable(); }}
            className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${
              mainTab === tab
                ? 'border-[#008A45] text-[#007038]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'Payments' ? 'Payments' : 'Refunds'}
          </button>
        ))}
      </div>

      {/* STATUS OVERVIEW — click a card to filter the table by that status.
          Only meaningful for the Payments tab: a refund's status is always
          Refunded, so the Downpayment/Fully Paid/Pending Verification split
          doesn't apply there. */}
      {mainTab === 'Payments' && (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-1.5 mb-3">
          <LayoutGrid size={13} className="text-slate-400" />
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Status Overview</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statusStats.map((s) => (
            <button
              key={s.key}
              onClick={() => { setActiveTab(s.key); scrollToTable(); }}
              className={`relative text-left rounded-xl border p-4 transition-all ${
                activeTab === s.key
                  ? 'border-[#008A45] ring-2 ring-[#008A45]/15 bg-[#EAF3F2]'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
              }`}
            >
              <p className={`text-xs font-semibold mb-1 flex items-center gap-1.5 ${activeTab === s.key ? 'text-[#007038]' : 'text-slate-500'}`}>
                {s.label}
                {s.key === 'Pending Verification' && pendingVerificationCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold">
                    {pendingVerificationCount}
                  </span>
                )}
              </p>
              <p className={`text-2xl font-extrabold ${activeTab === s.key ? 'text-[#007038]' : 'text-slate-900'}`}>{s.count}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">₱{s.amount.toLocaleString()}</p>
              <p className={`text-[11px] mt-2 ${activeTab === s.key ? 'text-[#007038]/80' : 'text-slate-400'}`}>{s.description}</p>
              <span className={`text-[10px] font-semibold ${activeTab === s.key ? 'text-[#007038]' : 'text-slate-400'}`}>
                {activeTab === s.key ? 'Filtering table below ✓' : 'Click to filter table below →'}
              </span>
            </button>
          ))}
        </div>
      </div>
      )}

      {/* FILTERS */}
      <div className={`bg-white rounded-2xl border shadow-sm p-5 transition-colors ${activePaymentFilterCount > 0 ? 'border-[#008A45]/30' : 'border-slate-200'}`}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Filter size={13} className="text-slate-400" />
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Filters</span>
            {activePaymentFilterCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EAF3F2] text-[#007038] text-[10px] font-bold border border-[#008A45]/30">
                {activePaymentFilterCount} active
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activePaymentFilterCount > 0 && (
              <button
                onClick={() => { setTableSearchTerm(''); setTypeFilter('All'); setMethodFilter('All'); setDatePreset('All Time'); setCustomStart(''); setCustomEnd(''); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <RotateCcw size={13} /> Clear all
              </button>
            )}
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <label className={`block text-[11px] font-semibold mb-1 ${tableSearchTerm ? 'text-[#007038]' : 'text-slate-500'}`}>Search</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Customer name or reference"
                value={tableSearchTerm}
                onChange={(e) => setTableSearchTerm(e.target.value)}
                className={`w-full border rounded-lg py-2.5 pl-4 pr-10 text-sm outline-none transition-colors ${tableSearchTerm ? 'border-[#008A45] bg-[#EAF3F2] ring-1 ring-[#008A45]/20' : 'border-slate-300 bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45]'}`}
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            </div>
          </div>

          <div>
            <label className={`block text-[11px] font-semibold mb-1 ${typeFilter !== 'All' ? 'text-[#007038]' : 'text-slate-500'}`}>Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className={`border rounded-lg px-3 py-2.5 text-sm outline-none transition-colors ${typeFilter !== 'All' ? 'border-[#008A45] bg-[#EAF3F2] ring-1 ring-[#008A45]/20' : 'border-slate-300 bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45]'}`}
            >
              <option value="All">All</option>
              <option value="Package">Packages</option>
              <option value="Short Order">Short Orders</option>
            </select>
          </div>

          <div>
            <label className={`block text-[11px] font-semibold mb-1 ${methodFilter !== 'All' ? 'text-[#007038]' : 'text-slate-500'}`}>Method</label>
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className={`border rounded-lg px-3 py-2.5 text-sm outline-none transition-colors ${methodFilter !== 'All' ? 'border-[#008A45] bg-[#EAF3F2] ring-1 ring-[#008A45]/20' : 'border-slate-300 bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45]'}`}
            >
              <option value="All">All</option>
              <option value="Cash">Cash</option>
              <option value="GCash">GCash</option>
              <option value="Bank Transfer">Bank Transfer</option>
            </select>
          </div>

          <div>
            <label className={`block text-[11px] font-semibold mb-1 ${datePreset !== 'All Time' ? 'text-[#007038]' : 'text-slate-500'}`}>Payment Date</label>
            <DateRangeFilter
              preset={datePreset}
              customStart={customStart}
              customEnd={customEnd}
              rangeStart={dateRangeStart}
              rangeEnd={dateRangeEnd}
              onPresetChange={setDatePreset}
              onCustomStartChange={setCustomStart}
              onCustomEndChange={setCustomEnd}
              onClear={() => { setDatePreset('All Time'); setCustomStart(''); setCustomEnd(''); }}
            />
          </div>
        </div>
      </div>

      {/* PAYMENTS TABLE — one row per booking/short order on the Payments
          tab (click a row to see every payment made against it); refunds
          are each their own event, so that tab stays one row per record. */}
      <div ref={tableRef} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden scroll-mt-4">
        <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm text-slate-800 flex justify-between items-center">
          <span>{mainTab === 'Refunds' ? 'Refunds' : (activeTab === 'All' ? 'All Payments' : activeTab)}</span>
          <span className="text-xs font-normal text-slate-500">
            {mainTab === 'Refunds'
              ? `${filteredPayments.length} result${filteredPayments.length === 1 ? '' : 's'}`
              : `${groupedPayments.length} booking${groupedPayments.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4">{renderSortHeader('client', 'Customer')}</th>
                <th className="p-4 font-bold">Reference</th>
                <th className="p-4 font-bold">Status</th>
                <th className="p-4 font-bold">Type</th>
                {mainTab === 'Refunds' ? (
                  <th className="p-4 font-bold">Method</th>
                ) : (
                  <th className="p-4 font-bold">Payments</th>
                )}
                <th className="p-4 font-bold">Amount</th>
                <th className="p-4 font-bold">Payment Status</th>
                <th className="p-4">{renderSortHeader('date', 'Date')}</th>
                <th className="p-4 font-bold text-center">Proof</th>
                {mainTab === 'Refunds' ? null : <th className="p-4 font-bold text-right">Actions</th>}
              </tr>
            </thead>
            {mainTab === 'Refunds' ? (
              <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
                {loading ? (
                  <tr><td colSpan="9" className="p-6 text-center text-slate-400">Loading refunds...</td></tr>
                ) : filteredPayments.length === 0 ? (
                  <tr><td colSpan="9" className="p-6 text-center text-slate-500 italic">No refunds found.</td></tr>
                ) : (
                  sortedPayments.map((payment) => {
                    const orderStatus = payment.booking?.booking_status || 'Unknown';
                    return (
                      <tr
                        key={payment.payment_id}
                        className="hover:bg-slate-50 transition-colors cursor-pointer bg-red-50/50"
                        onClick={() => handleRowClick(payment)}
                      >
                        <td className="p-4">
                          <p className="font-bold text-slate-900">{getClientName(payment)}</p>
                        </td>
                        <td className="p-4 text-slate-600">
                          <button
                            onClick={(e) => { e.stopPropagation(); goToBookingDetails(payment.booking_id, payment.booking?.booking_type); }}
                            className="text-[#008A45] hover:underline font-medium inline-flex items-center gap-1 cursor-pointer"
                            title="View full booking details"
                          >
                            {getBookingRef(payment)} <ExternalLink size={11} />
                          </button>
                        </td>
                        <td className="p-4">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${getOrderStatusBadge(orderStatus)}`}>
                            {orderStatus}
                          </span>
                        </td>
                        <td className="p-4 text-slate-600">
                          {payment.booking?.booking_type === 'Short Order' ? 'Short Order' : 'Package'}
                        </td>
                        {/* No payment method was ever captured for a refund —
                            it's money going out, not a way of paying. */}
                        <td className="p-4 font-medium text-slate-700">
                          <span className="text-slate-400" title="No payment method was recorded for this refund">—</span>
                        </td>
                        <td className="p-4 font-bold text-red-600">
                          -₱{Math.abs(payment.amount_paid || 0).toLocaleString()}
                        </td>
                        <td className="p-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusBadge('Refunded')}`}>
                            Refunded
                          </span>
                        </td>
                        <td className="p-4 text-slate-600">
                          {payment.pay_datetime ? new Date(payment.pay_datetime).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="p-4 text-center">
                          {renderProof(payment.pay_proof)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            ) : (
              <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
                {loading ? (
                  <tr><td colSpan="9" className="p-6 text-center text-slate-400">Loading payments...</td></tr>
                ) : groupedPayments.length === 0 ? (
                  <tr><td colSpan="9" className="p-6 text-center text-slate-500 italic">No payments found.</td></tr>
                ) : (
                  sortedGroupedPayments.map((group) => {
                    const { latest } = group;
                    const orderStatus = group.booking?.booking_status || 'Unknown';
                    const isCancelledOrRejected = orderStatus === 'Rejected' || orderStatus === 'Cancelled';
                    // Only 'Pending Verification' still needs action — a
                    // 'Proof Rejected' row is already a resolved action (the
                    // manager rejected it), not something still awaiting one,
                    // so it must not keep showing Verify/Reject buttons.
                    const hasPendingVerification = group.entries.some(p => p.pay_status === 'Pending Verification');
                    // Prior payments relative to the latest one — same rule
                    // the row used before grouping: only payments that landed
                    // at or before this one count toward "already paid",
                    // so the label reflects the ledger's state at that moment.
                    const priorForLatest = payments.filter(p => p.booking_id === latest.booking_id
                      && p.payment_id !== latest.payment_id
                      && new Date(p.pay_datetime || 0) <= new Date(latest.pay_datetime || 0));
                    return (
                      <tr
                        key={group.bookingId}
                        className={`hover:bg-slate-50 transition-colors cursor-pointer ${isCancelledOrRejected ? 'opacity-70' : ''}`}
                        onClick={() => handleRowClick(latest)}
                      >
                        <td className="p-4">
                          <p className="font-bold text-slate-900">{getClientName(latest)}</p>
                        </td>
                        <td className="p-4 text-slate-600">
                          <button
                            onClick={(e) => { e.stopPropagation(); goToBookingDetails(latest.booking_id, group.booking?.booking_type); }}
                            className="text-[#008A45] hover:underline font-medium inline-flex items-center gap-1 cursor-pointer"
                            title="View full booking details"
                          >
                            {getBookingRef(latest)} <ExternalLink size={11} />
                          </button>
                        </td>
                        <td className="p-4">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${getOrderStatusBadge(orderStatus)}`}>
                            {orderStatus}
                          </span>
                        </td>
                        <td className="p-4 text-slate-600">
                          {group.booking?.booking_type === 'Short Order' ? 'Short Order' : 'Package'}
                        </td>
                        <td className="p-4 font-medium text-slate-700">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRowClick(latest); }}
                            className="inline-flex items-center gap-1 text-slate-600 hover:text-[#008A45] hover:underline"
                            title="View all payments for this booking"
                          >
                            {group.count} payment{group.count === 1 ? '' : 's'} <ChevronRight size={12} />
                          </button>
                        </td>
                        <td className="p-4 font-bold text-slate-900">
                          ₱{group.totalPaid.toLocaleString()}
                        </td>
                        {/* Shows the derived kind of the MOST RECENT payment,
                            not the booking overall — so a booking's history
                            still reads Downpayment → Partial payment → Fully
                            Paid as each new payment lands, instead of every
                            row flipping to "Fully Paid" the moment the
                            balance clears. */}
                        <td className="p-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusBadge(latest.pay_status)}`}>
                            {describePaymentKind(latest, priorForLatest, group.booking?.total_amount)}
                          </span>
                        </td>
                        <td className="p-4 text-slate-600">
                          {latest.pay_datetime ? new Date(latest.pay_datetime).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="p-4 text-center">
                          {renderProof(latest.pay_proof)}
                        </td>
                        <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                          {hasPendingVerification && (
                            <div className="flex items-center justify-end gap-3">
                              <button
                                onClick={() => openVerifyModal(group.entries.find(p => p.pay_status === 'Pending Verification'))}
                                disabled={isVerifying}
                                className="text-green-600 hover:text-green-800 transition-colors disabled:opacity-50"
                                title="Verify Payment"
                              >
                                <Check size={16} />
                              </button>
                              <button
                                onClick={() => openRejectProofModal(group.entries.find(p => p.pay_status === 'Pending Verification'))}
                                disabled={isVerifying}
                                className="text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                                title="Reject Proof"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            )}
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
                      {selectedPaymentDetail.pay_status === 'Refunded'
                        ? 'Refunded'
                        : describePaymentKind(
                            selectedPaymentDetail,
                            payments.filter(p => p.booking_id === selectedPaymentDetail.booking_id
                              && p.payment_id !== selectedPaymentDetail.payment_id
                              && new Date(p.pay_datetime || 0) <= new Date(selectedPaymentDetail.pay_datetime || 0)),
                            selectedPaymentDetail.booking?.total_amount,
                          )}
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
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-500">Order</span>
                    <button
                      onClick={() => goToBookingDetails(selectedPaymentDetail.booking_id, selectedPaymentDetail.booking?.booking_type)}
                      className="text-xs font-semibold text-[#008A45] hover:underline inline-flex items-center gap-1 cursor-pointer"
                      title="View full booking details"
                    >
                      View full details <ExternalLink size={11} />
                    </button>
                  </div>
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
                      .sort((a, b) => new Date(b.pay_datetime || 0) - new Date(a.pay_datetime || 0))
                      .map(p => {
                        const kind = p.pay_status === 'Refunded'
                          ? 'Refunded'
                          : describePaymentKind(
                              p,
                              payments.filter(other => other.booking_id === p.booking_id
                                && other.payment_id !== p.payment_id
                                && new Date(other.pay_datetime || 0) <= new Date(p.pay_datetime || 0)),
                              p.booking?.total_amount ?? selectedPaymentDetail.booking?.total_amount,
                            );
                        return (
                          <div key={p.payment_id} className="flex justify-between items-center bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm">
                            <span>{kind} – ₱{Math.abs(p.amount_paid).toLocaleString()}</span>
                            <span className="text-slate-500">{p.pay_datetime ? new Date(p.pay_datetime).toLocaleDateString() : ''}</span>
                          </div>
                        );
                      })}
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
                <p className="text-xs text-slate-500 mt-0.5">{filteredSummaryModalData.length} of {summaryModalData.length} record(s) shown</p>
              </div>
              <button
                onClick={closeSummaryModal}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className={`px-6 py-3 border-b space-y-2 shrink-0 ${activeSummaryFilterCount > 0 ? 'bg-emerald-50/40 border-emerald-100' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-center gap-3">
                {activeSummaryFilterCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shrink-0">
                    {activeSummaryFilterCount} active
                  </span>
                )}
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input
                    type="text"
                    placeholder="Search by customer name or reference"
                    value={summarySearchTerm}
                    onChange={(e) => setSummarySearchTerm(e.target.value)}
                    className={`w-full pl-8 pr-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white ${summarySearchTerm.trim() ? 'border-emerald-300' : 'border-slate-300'}`}
                  />
                </div>
                <select
                  value={summaryTypeFilter}
                  onChange={(e) => setSummaryTypeFilter(e.target.value)}
                  className={`border rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${summaryTypeFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
                >
                  <option value="All">All types</option>
                  <option value="Package">Package</option>
                  <option value="Short Order">Short Order</option>
                </select>
                {/* Only 'collected' lists payment rows; the other two list
                    bookings, which carry no pay_method to filter on. */}
                {summaryModalType === 'collected' && (
                  <select
                    value={summaryMethodFilter}
                    onChange={(e) => setSummaryMethodFilter(e.target.value)}
                    className={`border rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${summaryMethodFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
                  >
                    <option value="All">All methods</option>
                    <option value="Cash">Cash</option>
                    <option value="GCash">GCash</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select>
                )}
                {activeSummaryFilterCount > 0 && (
                  <button
                    onClick={() => {
                      setSummarySearchTerm('');
                      setSummaryTypeFilter('All');
                      setSummaryMethodFilter('All');
                      setSummaryDatePreset('All Time');
                      setSummaryDateCustomStart('');
                      setSummaryDateCustomEnd('');
                    }}
                    className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    Clear filters
                  </button>
                )}
              </div>
              <div className="flex flex-col items-start gap-1">
                <p className="text-xs font-semibold text-slate-600">
                  Filter by {summaryModalType === 'collected' ? 'payment date' : 'event date'}:
                </p>
                <DateRangeFilter
                  preset={summaryDatePreset}
                  customStart={summaryDateCustomStart}
                  customEnd={summaryDateCustomEnd}
                  rangeStart={summaryDateRangeStart}
                  rangeEnd={summaryDateRangeEnd}
                  onPresetChange={setSummaryDatePreset}
                  onCustomStartChange={setSummaryDateCustomStart}
                  onCustomEndChange={setSummaryDateCustomEnd}
                  onClear={() => { setSummaryDatePreset('All Time'); setSummaryDateCustomStart(''); setSummaryDateCustomEnd(''); }}
                />
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {summaryModalData.length === 0 ? (
                <div className="text-center py-10 text-slate-500">No records found.</div>
              ) : filteredSummaryModalData.length === 0 ? (
                <div className="text-center py-10 text-slate-500">No records match your search/filter.</div>
              ) : (
                <>
                  {/* Collected & Fully Paid – show payment list */}
                  {summaryModalType === 'collected' && (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                          <th className="p-3">Reference</th>
                          <th className="p-3">Customer</th>
                          <th className="p-3">Type</th>
                          <th className="p-3">Method</th>
                          <th className="p-3 text-right">Amount</th>
                          <th className="p-3">Payment Status</th>
                          <th className="p-3">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredSummaryModalData.map((item, idx) => (
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
                            ₱{filteredSummaryModalData.reduce((sum, p) => sum + (p.amount_paid || 0), 0).toLocaleString()}
                          </td>
                          <td colSpan="2"></td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {/* Outstanding Balance – records with the amount still due */}
                  {summaryModalType === 'fullypaid' && (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                          <th className="p-3">Reference</th>
                          <th className="p-3">Customer</th>
                          <th className="p-3">Type</th>
                          <th className="p-3 text-right">Total</th>
                          <th className="p-3 text-right">Paid</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredSummaryModalData.map((item, idx) => (
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
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                        <tr>
                          <td colSpan="4" className="p-3 text-right font-bold text-slate-700">
                            {filteredSummaryModalData.length} booking(s) paid in full:
                          </td>
                          <td className="p-3 text-right font-bold text-emerald-700">
                            ₱{filteredSummaryModalData.reduce((sum, b) => sum + (b.paid || 0), 0).toLocaleString()}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {summaryModalType === 'pending' && (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                          <th className="p-3">Reference</th>
                          <th className="p-3">Customer</th>
                          <th className="p-3">Type</th>
                          <th className="p-3 text-right">Total</th>
                          <th className="p-3 text-right">Paid</th>
                          <th className="p-3 text-right">Remaining</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredSummaryModalData.map((item, idx) => (
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
                          <td colSpan="5" className="p-3 text-right font-bold text-slate-700">Total outstanding:</td>
                          <td className="p-3 text-right font-bold text-red-600">
                            ₱{filteredSummaryModalData.reduce((sum, b) => sum + (b.remaining || 0), 0).toLocaleString()}
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
                Record New Payment
              </h2>
              <button
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6 text-left">
              {/* Booking Selection with Search — same pattern as picking a
                  customer when adding a booking/order: search box, a
                  floating list of matches, click to pick. */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Booking *</label>
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      type="text"
                      placeholder="Search by customer name or booking ref..."
                      value={bookingSearchTerm}
                      onChange={(e) => {
                        setBookingSearchTerm(e.target.value);
                        setShowBookingList(true);
                        if (formData.booking_id) setFormData(prev => ({ ...prev, booking_id: '' }));
                      }}
                      onFocus={() => setShowBookingList(true)}
                      className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                      required
                    />
                  </div>
                  {showBookingList && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                      {filteredBookings.length > 0 ? (
                        filteredBookings.map((b) => {
                          const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';
                          const remaining = getRemainingBalance(b.booking_id);
                          return (
                            <button
                              key={b.booking_id}
                              type="button"
                              onClick={() => selectBooking(b)}
                              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-slate-900">{bookingRefFor(b)} — {customerName}</span>
                                <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${b.booking_type === 'Short Order' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-violet-50 text-violet-700 border-violet-200'}`}>
                                  {b.booking_type === 'Short Order' ? 'Short Order' : 'Package'}
                                </span>
                              </div>
                              <div className="flex items-center flex-wrap gap-1.5 text-[11px] text-slate-500 mt-1">
                                <span className={`px-1.5 py-0.5 rounded-full font-semibold border ${getOrderStatusBadge(b.booking_status)}`}>
                                  {b.booking_status}
                                </span>
                                {b.booking_status === 'Completed' && (
                                  <span className="px-1.5 py-0.5 rounded-full font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                                    Balance Due
                                  </span>
                                )}
                                <span>Remaining: <b className="text-slate-700">₱{remaining.toLocaleString()}</b></span>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="p-3 text-center text-sm text-slate-500">No matching bookings with a balance due.</div>
                      )}
                    </div>
                  )}
                </div>
                {!formData.booking_id && (
                  <p className="text-xs text-slate-400 mt-1">Type to search by customer name or booking ref (e.g. {bookingRefFor(bookings[0]) !== 'N/A' ? bookingRefFor(bookings[0]) : 'BKG-0001'}).</p>
                )}
                {formData.booking_id && selectedBooking && (
                  <p className="text-xs text-green-600 mt-1 font-medium">
                    ✅ Selected: {bookingRefFor(selectedBooking)} — {selectedBooking.customer ? `${selectedBooking.customer.first_name} ${selectedBooking.customer.last_name}` : 'Unknown'}
                    {selectedBooking.booking_status === 'Completed' && (
                      <span className="ml-2 text-amber-600">(Completed — ₱{remainingBalanceForSelected.toLocaleString()} still owed)</span>
                    )}
                  </p>
                )}
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
                    className={`w-full border rounded-lg p-2.5 text-sm focus:ring-2 outline-none ${amountError ? 'border-red-400 focus:ring-red-200 focus:border-red-400 bg-red-50/40' : 'border-slate-300 focus:ring-[#008A45]/20 focus:border-[#008A45]'}`}
                  />
                  {amountError && (
                    <p className="text-xs text-red-600 mt-1 font-semibold">{amountError}</p>
                  )}
                  {!amountError && selectedBooking && (
                    <p className="text-xs text-slate-400 mt-1">Max: ₱{remainingBalanceForSelected.toLocaleString()}</p>
                  )}
                  {!amountError && selectedBooking && (() => {
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
                  <p className="text-xs text-slate-400 mt-1">Marking Fully Paid requires the amount to cover the full remaining balance.</p>
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
                  <span className="text-red-500 ml-1">*</span>
                </label>
                <label className={`border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center transition-colors cursor-pointer text-center relative overflow-hidden h-24 ${fileError ? 'border-red-400 bg-red-50/40 hover:bg-red-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}>
                  <input type="file" onChange={handleFileChange} accept="image/*" className="hidden" />
                  <ImageIcon size={20} className={fileError ? 'text-red-400 mb-1' : 'text-slate-400 mb-1'} />
                  <span className="text-xs font-semibold text-slate-600">
                    {selectedFile ? selectedFile.name : 'Upload Image'}
                  </span>
                  <span className="text-[10px] text-slate-400 mt-0.5">PNG, JPG up to 5MB</span>
                </label>
                {fileError ? (
                  <p className="text-xs text-red-600 mt-1 font-semibold">{fileError}</p>
                ) : (
                  <p className="text-xs text-slate-400 mt-1">
                    Upload a proof image; will be stored in Supabase Storage.
                  </p>
                )}
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
                  {uploading ? 'Uploading...' : (isSubmitting ? 'Saving...' : 'Record Payment')}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===== VERIFY PAYMENT MODAL ===== */}
      {isVerifyModalOpen && verifyTarget && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Verify Payment</h2>
              <button onClick={() => setIsVerifyModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-left">
              <p className="text-sm text-slate-600">Review the proof and confirm this payment from {getClientName(verifyTarget)} is legitimate.</p>

              <div className="flex gap-4 items-center bg-slate-50 border border-slate-200 rounded-lg p-3">
                <button
                  type="button"
                  onClick={() => {
                    const url = getProofUrl(verifyTarget.pay_proof);
                    if (url) { setProofModalUrl(url); setIsProofModalOpen(true); }
                  }}
                  className="shrink-0 w-20 h-20 rounded-lg border border-slate-200 overflow-hidden bg-white flex items-center justify-center hover:shadow-md transition-shadow"
                  title="Click to view full proof"
                >
                  {verifyTarget.pay_proof && verifyTarget.pay_proof !== 'placeholder.png' && verifyTarget.pay_proof !== 'refund_placeholder.png' ? (
                    <img src={getProofUrl(verifyTarget.pay_proof)} alt="Payment proof" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-slate-400 italic px-1 text-center">No proof</span>
                  )}
                </button>
                <div className="flex-1 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Amount</span>
                    <span className="font-bold text-[#008A45]">₱{(verifyTarget.amount_paid || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Booking Total</span>
                    <span className="font-semibold text-slate-900">₱{(verifyTarget.booking?.total_amount || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Payment Method *</label>
                <div className="grid grid-cols-3 gap-2">
                  {['Cash', 'GCash', 'Bank Transfer'].map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setVerifyMethod(method)}
                      className={`flex items-center justify-center gap-1.5 p-2.5 rounded-lg border-2 font-semibold text-xs transition-all ${
                        verifyMethod === method
                          ? 'border-[#008A45] bg-[#EAF3F2] text-slate-900'
                          : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-3 h-3 rounded-full border flex items-center justify-center ${verifyMethod === method ? 'border-[#008A45]' : 'border-slate-400'}`}>
                        {verifyMethod === method && <div className="w-1.5 h-1.5 rounded-full bg-[#008A45]" />}
                      </div>
                      {method}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsVerifyModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleVerifyConfirm}
                  disabled={isVerifying}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isVerifying ? 'Verifying...' : 'Verify Payment'}
                </button>
              </div>
            </div>
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
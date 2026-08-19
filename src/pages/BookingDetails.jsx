// src/pages/BookingDetails.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, X, Plus, RefreshCw, Edit, Trash2, Lock, ClipboardList, Image as ImageIcon, Search } from 'lucide-react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePasswordConfirm } from '../contexts/PasswordConfirmContext';
import { usePaymentHandlers } from '../hooks/usePaymentHandlers';
import { useApprovalHandlers } from '../hooks/useApprovalHandlers';
import { useRejectionHandlers } from '../hooks/useRejectionHandlers';
import { useCancellationHandlers } from '../hooks/useCancellationHandlers';
import { useVerificationHandlers } from '../hooks/useVerificationHandlers';
import { useConfirmationHandlers } from '../hooks/useConfirmationHandlers';
import { useCompletionHandlers } from '../hooks/useCompletionHandlers';
import { allocateEquipmentForBooking } from '../utils/equipment';
import { sumVerifiedPositivePayments, sumVerifiedDownpayments, isPaymentLedgerLocked } from '../utils/payments';
import { bookingEditLockedMessage } from '../utils/bookingStatus';
import { autoCompletePastEvents, hasUnpaidPastEvent } from '../utils/autoComplete';
import ApprovalAvailabilityCheck from '../components/ApprovalAvailabilityCheck';
import { errorInputClass } from '../utils/formErrors';
import DateTimePicker from '../components/DateTimePicker';

export default function BookingDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const { requestPasswordConfirm } = usePasswordConfirm();

  // --- Local state (not duplicated) ---
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [menuSelections, setMenuSelections] = useState([]);
  const [equipment, setEquipment] = useState([]);

  // --- Edit Modal state (unique) ---
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Field-level errors for the Edit Booking form — highlights exactly
  // which input is blocking submission (red border + inline message)
  // instead of only a toast.
  const [editFieldErrors, setEditFieldErrors] = useState({});
  const [customers, setCustomers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [packageCategories, setPackageCategories] = useState([]);
  const [categoryMenuItems, setCategoryMenuItems] = useState({});
  const [selectedPackageInfo, setSelectedPackageInfo] = useState(null); // ✅ NEW: store package pricing
  const [editFormData, setEditFormData] = useState({
    customer_id: '',
    package_id: '',
    booking_type: 'Package',
    event_datetime: '',
    venue: '',
    pax_count: '',
    motif_color: '',
    notes: '',
    total_amount: '',
    delivery_fee: '0',
    menu_selections: {},
  });

  // --- Equipment Assignment modal state (unique) ---
  const [isAssignEquipModalOpen, setIsAssignEquipModalOpen] = useState(false);
  const [equipmentList, setEquipmentList] = useState([]);
  const [assignEquipData, setAssignEquipData] = useState({ equipment_id: '', quantity: 1, notes: '' });
  const [isAssignSubmitting, setIsAssignSubmitting] = useState(false);
  const [equipSearchTerm, setEquipSearchTerm] = useState('');

  // --- Edit Equipment Assignment modal state (unique) ---
  const [isEditEquipModalOpen, setIsEditEquipModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [editEquipData, setEditEquipData] = useState({ quantity: 1 });

  // --- Refund after rejection/cancellation modal (still local) ---
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const [refundModalAmount, setRefundModalAmount] = useState('');
  const [refundModalRemarks, setRefundModalRemarks] = useState('');
  const [refundModalFile, setRefundModalFile] = useState(null);
  const [isRefundSubmitting, setIsRefundSubmitting] = useState(false);

  // --- Proof Image Modal state ---
  const [isProofModalOpen, setIsProofModalOpen] = useState(false);
  const [proofModalUrl, setProofModalUrl] = useState('');

  // --- FETCH DATA ---
  const fetchBooking = async () => {
    setLoading(true);
    try {
      const { data: bookingData, error: bookingError } = await supabase
        .from('booking')
        .select(`
          *,
          customer:customer_id (first_name, last_name, contact_no, cus_address, email_address, customer_id),
          package:package_id (pkg_name, pkg_price, pkg_description, pricing_type, max_pax, extra_pax_price)
        `)
        .eq('booking_id', id)
        .single();
      if (bookingError) throw bookingError;
      setBooking(bookingData);

      if (bookingData && !bookingData.is_read) {
        await supabase.from('booking').update({ is_read: true }).eq('booking_id', id);
        setBooking(prev => ({ ...prev, is_read: true }));
      }

      // Payments
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payment')
        .select('*')
        .eq('booking_id', id)
        .order('pay_datetime', { ascending: false });
      if (paymentsError) throw paymentsError;
      const filtered = (paymentsData || []).filter(p => !(p.amount_paid === 0 && p.pay_status === 'Pending'));
      setPayments(filtered);

      // Passive auto-complete: no server-side cron in this stack, so this
      // runs whenever the details page is loaded — completes this booking
      // if it's Confirmed, past its event date, and fully paid.
      const completedIds = await autoCompletePastEvents([{
        booking_id: bookingData.booking_id,
        booking_status: bookingData.booking_status,
        event_datetime: bookingData.event_datetime,
        total_amount: bookingData.total_amount,
        positivePayments: sumVerifiedPositivePayments(filtered),
      }]);
      if (completedIds.length > 0) {
        fetchBooking();
        return;
      }

      // Menu selections
      if (bookingData.menu_selections && typeof bookingData.menu_selections === 'object') {
        const selections = bookingData.menu_selections;
        const categoryIds = Object.keys(selections);
        const menuItemIds = Object.values(selections);
        if (categoryIds.length > 0) {
          const { data: categories } = await supabase
            .from('category')
            .select('category_id, category_name')
            .in('category_id', categoryIds);
          const { data: menuItems } = await supabase
            .from('menu_item')
            .select('menu_item_id, menu_name')
            .in('menu_item_id', menuItemIds);
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
      } else {
        setMenuSelections([]);
      }

      // Equipment
      const { data: equipData } = await supabase
        .from('booking_equipment')
        .select(`assignment_id, quantity, returned, equipment:equipment_id (eqm_name, equipment_id)`)
        .eq('booking_id', id)
        .order('assigned_at', { ascending: true });
      setEquipment(
        equipData?.map(item => ({
          assignment_id: item.assignment_id,
          equipment_id: item.equipment?.equipment_id,
          eqm_name: item.equipment?.eqm_name || 'Unknown',
          quantity: item.quantity,
          returned: item.returned,
        })) || []
      );
    } catch (error) {
      console.error(error);
      toast.error('Unable to load booking details.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch dropdown data for edit modal
  useEffect(() => {
    fetchBooking();
    const fetchDropdownData = async () => {
      try {
        const { data: cust } = await supabase
          .from('customer')
          .select('customer_id, first_name, last_name')
          .eq('account_status', 'Active')
          .order('first_name');
        setCustomers(cust || []);
        const { data: pkgs } = await supabase
          .from('package')
          .select('package_id, pkg_name, pricing_type, max_pax, extra_pax_price')
          .eq('pkg_availability', 'Available')
          .order('pkg_name');
        setPackages(pkgs || []);
      } catch (error) {
        console.error('Dropdown fetch error:', error);
      }
    };
    fetchDropdownData();
  }, [id]);

  // ============================================================
  // HOOKS: Payment, Approval, Rejection, Cancellation
  // ============================================================

  // --- Payment Handlers ---
  const {
    isPaymentModalOpen,
    setIsPaymentModalOpen,
    isEditPaymentModalOpen,
    setIsEditPaymentModalOpen,
    editingPayment,
    paymentFormData,
    editPaymentFormData,
    selectedFile,
    editSelectedFile,
    isPaymentSubmitting,
    uploading,
    paymentAmountError,
    paymentFileError,
    editAmountError,
    editFileError,
    openPaymentModal,
    handlePaymentInputChange,
    handlePaymentFileChange,
    handlePaymentSubmit,
    openEditPaymentModal,
    handleEditPaymentSubmit,
    handleDeletePayment,
    setEditPaymentFormData,
    setEditSelectedFile,
    getProofUrl,
    setPaymentFormData,
  } = usePaymentHandlers({
    bookingId: id,
    payments,
    totalAmount: booking?.total_amount || 0,
    fetchData: fetchBooking,
    customerId: booking?.customer_id,
    bookingStatus: booking?.booking_status,
  });

  // --- Approval Handlers ---
  const {
    isApprovalModalOpen,
    setIsApprovalModalOpen,
    approvalBooking,
    approvalData,
    isSubmitting: isApprovalSubmitting,
    openApprovalModal,
    handleApprovalInputChange,
    handleFinalizeApproval,
  } = useApprovalHandlers({
    booking,
    payments,
    fetchData: fetchBooking,
  });

  // Reported by ApprovalAvailabilityCheck inside the approve modal — lets us
  // disable the Approve button instead of letting the manager click through
  // and get blocked by the hook's equipment hard-check afterward.
  const [approvalEquipmentStatus, setApprovalEquipmentStatus] = useState({ applicable: false, loading: false, sufficient: true, shortages: [] });
  const approveDisabled = isApprovalSubmitting || (approvalEquipmentStatus.applicable && (approvalEquipmentStatus.loading || !approvalEquipmentStatus.sufficient));

  // --- Rejection Handlers (with wrapper functions) ---
  const getBooking = (bookingId) => (bookingId === booking?.booking_id ? booking : null);
  const getPaymentSummary = (bookingId) => {
    if (bookingId === booking?.booking_id) {
      const positivePayments = sumVerifiedPositivePayments(payments);
      const downpaymentPaid = sumVerifiedDownpayments(payments);
      return { positivePayments, downpaymentPaid };
    }
    return { positivePayments: 0, downpaymentPaid: 0 };
  };

  const {
    isRejectionModalOpen,
    setIsRejectionModalOpen,
    rejectionReason,
    setRejectionReason,
    rejectionRefundAmount,
    setRejectionRefundAmount,
    rejectionRefundRemarks,
    setRejectionRefundRemarks,
    rejectionRefundFile,
    setRejectionRefundFile,
    showRejectionRefund,
    rejectionMaxRefundable,
    openRejectionModal,
    handleRejectConfirm,
  } = useRejectionHandlers({
    getBooking,
    getPaymentSummary,
    fetchData: fetchBooking,
  });

  // --- Cancellation Handlers ---
  const {
    isCancelModalOpen,
    setIsCancelModalOpen,
    cancelReason,
    setCancelReason,
    refundAmount,
    setRefundAmount,
    refundRemarks,
    setRefundRemarks,
    refundFile,
    setRefundFile,
    isCancelling,
    openCancelModal,
    handleCancelBooking,
  } = useCancellationHandlers({
    booking,
    payments,
    fetchData: fetchBooking,
  });

  // --- Confirmation Handlers (Approved -> Confirmed) ---
  const {
    canConfirmBooking,
    isConfirming,
    handleConfirmBooking,
  } = useConfirmationHandlers({
    booking,
    payments,
    fetchData: fetchBooking,
  });

  // --- Completion Handlers (Confirmed -> Completed) ---
  const {
    canMarkCompleted,
    isFullyPaid: isCompletionFullyPaid,
    remainingBalance: completionRemainingBalance,
    isCompleting,
    handleMarkCompleted,
  } = useCompletionHandlers({
    booking,
    payments,
    fetchData: fetchBooking,
  });

  // --- Verification Handlers (Pending Verification payments) ---
  const {
    isRejectProofModalOpen,
    setIsRejectProofModalOpen,
    rejectProofTarget,
    rejectProofReason,
    setRejectProofReason,
    isVerifying,
    isVerifyModalOpen,
    setIsVerifyModalOpen,
    verifyTarget,
    verifyMethod,
    setVerifyMethod,
    openVerifyModal,
    handleVerifyConfirm,
    openRejectProofModal,
    handleRejectProofConfirm,
  } = useVerificationHandlers({
    payments,
    totalAmount: booking?.total_amount || 0,
    fetchData: fetchBooking,
  });

  // --- Refund after rejection/cancellation (local) ---
  // Uses the same policy-aware `remainingRefundableAmount` computed below in
  // the render body (excludes the forfeited downpayment when cancellation
  // happened within 3 days of the event) — must NOT recompute a simpler
  // "total paid minus already refunded" figure here, or the modal's max
  // will silently allow refunding the forfeited downpayment.
  const openRefundModal = () => {
    setRefundModalAmount(remainingRefundableAmount > 0 ? remainingRefundableAmount.toFixed(2) : '');
    setRefundModalRemarks('');
    setRefundModalFile(null);
    setIsRefundModalOpen(true);
  };

  const handleRefundSubmit = async (e) => {
    e.preventDefault();

    const amount = parseFloat(refundModalAmount) || 0;
    if (amount <= 0) {
      toast.error('Please enter a valid refund amount.');
      return;
    }
    if (amount > remainingRefundableAmount) {
      toast.error(`Amount exceeds remaining refundable (₱${remainingRefundableAmount.toFixed(2)}).`);
      return;
    }
    if (!refundModalFile) {
      toast.error('Please upload a proof of refund receipt.');
      return;
    }

    // --- FILE VALIDATION for refund ---
    const file = refundModalFile;
    const maxSize = 5 * 1024 * 1024;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.');
      return;
    }
    if (file.size > maxSize) {
      toast.error(`File is too large. Maximum size is 5 MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)} MB.`);
      return;
    }

    setIsRefundSubmitting(true);
    try {
      let proofUrl = 'refund_placeholder.png';
      const fileExt = file.name.split('.').pop();
      const fileName = `refunds/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('images')
        .upload(fileName, file);
      if (uploadError) {
        let msg = 'Failed to upload refund proof.';
        if (uploadError.message?.includes('bucket not found')) msg = 'Storage bucket is not configured.';
        else if (uploadError.message?.includes('permission')) msg = 'Permission denied.';
        else if (uploadError.message?.includes('too large')) msg = 'File exceeds storage limit.';
        else if (uploadError.message?.includes('duplicate')) msg = 'A file with this name already exists.';
        throw new Error(msg);
      }
      const { data: publicUrlData } = supabase.storage
        .from('images')
        .getPublicUrl(fileName);
      proofUrl = publicUrlData.publicUrl;

      const { error: refundError } = await supabase
        .from('payment')
        .insert([{
          booking_id: id,
          amount_paid: -amount,
          pay_method: 'Refund',
          pay_status: 'Refunded',
          pay_datetime: new Date().toISOString(),
          pay_proof: proofUrl,
          customer_id: booking.customer_id,
          remarks: refundModalRemarks || 'Refund processed after rejection/cancellation',
        }]);
      if (refundError) throw refundError;

      const refundNote = `[REFUND] Amount: ₱${amount.toFixed(2)}. ${refundModalRemarks || ''}`;
      const updatedNotes = booking.notes ? `${booking.notes}\n${refundNote}` : refundNote;
      await supabase
        .from('booking')
        .update({ notes: updatedNotes })
        .eq('booking_id', id);

      setIsRefundModalOpen(false);
      fetchBooking();
      toast.success('Refund recorded successfully.');
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to record refund.');
    } finally {
      setIsRefundSubmitting(false);
    }
  };

  // --- DELETE (unique) ---
  const handleDelete = async () => {
    const confirmed = await showConfirm({
      title: 'Delete Booking?',
      message: `Are you sure you want to permanently delete this ${booking.booking_status} booking? This action cannot be undone. All associated payments, equipment, and vehicle assignments will also be deleted.`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: 'Deleting this booking is permanent. Re-enter your password to continue.',
    });
    if (!passwordOk) return;

    try {
      const { error: paymentsError } = await supabase
        .from('payment')
        .delete()
        .eq('booking_id', id);
      if (paymentsError) throw paymentsError;
      await supabase.from('booking_equipment').delete().eq('booking_id', id);
      await supabase.from('vehicle_assign').delete().eq('booking_id', id);
      const { error } = await supabase
        .from('booking')
        .delete()
        .eq('booking_id', id);
      if (error) throw error;
      toast.success('Booking deleted.');
      navigate('/app/bookings');
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete booking.');
    }
  };

  // --- EDIT MODAL (unique) ---
  const openEditModal = () => {
    if (!booking) return;
    if (isPaymentLedgerLocked(booking.booking_status)) {
      toast.error(bookingEditLockedMessage(booking.booking_status));
      return;
    }
    setEditFormData({
      customer_id: booking.customer_id || '',
      package_id: booking.package_id || '',
      booking_type: booking.booking_type || 'Package',
      event_datetime: booking.event_datetime ? new Date(booking.event_datetime).toISOString().slice(0, 16) : '',
      venue: booking.venue || '',
      pax_count: booking.pax_count?.toString() || '',
      motif_color: booking.motif_color || '',
      notes: booking.notes || '',
      total_amount: booking.total_amount?.toString() || '',
      delivery_fee: booking.delivery_fee?.toString() || '0',
      menu_selections: booking.menu_selections || {},
    });
    // Fetch package info for the current package
    if (booking.package_id) {
      fetchPackageDetails(booking.package_id);
    } else {
      setPackageCategories([]);
      setCategoryMenuItems({});
      setSelectedPackageInfo(null);
    }
    setEditFieldErrors({});
    setIsEditModalOpen(true);
  };

  // --- Fetch package categories, menu items, and pricing ---
  const fetchPackageDetails = async (packageId) => {
    try {
      // 1. Fetch package pricing
      const { data: pkgData, error: pkgError } = await supabase
        .from('package')
        .select('pkg_price, pricing_type, max_pax, extra_pax_price, minimum_pax')
        .eq('package_id', packageId)
        .maybeSingle();
      if (!pkgError && pkgData) {
        setSelectedPackageInfo(pkgData);
      } else {
        setSelectedPackageInfo(null);
      }

      // 2. Fetch categories and menu items
      const { data: catData, error: catError } = await supabase
        .from('package_category')
        .select(`category_id, category:category_id (category_id, category_name)`)
        .eq('package_id', packageId);
      if (catError) throw catError;
      const categories = catData.map(item => ({
        category_id: item.category.category_id,
        category_name: item.category.category_name,
      }));
      setPackageCategories(categories);

      const menuItemsMap = {};
      for (const cat of categories) {
        const { data: menuData, error: menuError } = await supabase
          .from('menu_item')
          .select('menu_item_id, menu_name')
          .eq('category_id', cat.category_id)
          .eq('menu_availability', 'Available')
          .order('menu_name');
        if (menuError) throw menuError;
        menuItemsMap[cat.category_id] = menuData || [];
      }
      setCategoryMenuItems(menuItemsMap);
    } catch (error) {
      console.error('Error fetching package details:', error);
      toast.error('Unable to load package details.');
    }
  };

  // --- Recalculate total based on selected package info and pax ---
  const recalcTotal = () => {
    const pkg = selectedPackageInfo;
    const pax = parseInt(editFormData.pax_count) || 0;
    const deliveryFee = parseFloat(editFormData.delivery_fee) || 0;

    if (!pkg) {
      // No package selected, keep existing total
      return;
    }

    let total = 0;
    if (pkg.pricing_type === 'per_pax') {
      total = (pkg.pkg_price || 0) * pax;
    } else {
      // fixed pricing
      total = pkg.pkg_price || 0;
      if (pkg.max_pax && pax > pkg.max_pax) {
        total += (pax - pkg.max_pax) * (pkg.extra_pax_price || 0);
      }
    }
    total += deliveryFee;

    setEditFormData(prev => ({
      ...prev,
      total_amount: total.toFixed(2),
    }));
  };

  // Effect to recalc total when package info, pax, or delivery fee changes
  useEffect(() => {
    if (isEditModalOpen) {
      recalcTotal();
    }
  }, [selectedPackageInfo, editFormData.pax_count, editFormData.delivery_fee, isEditModalOpen]);

  const handleEditInputChange = (e) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({ ...prev, [name]: value }));
    setEditFieldErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
    // If package changes, reset menu selections and fetch new package details
    if (name === 'package_id') {
      // Reset menu selections
      setEditFormData(prev => ({ ...prev, menu_selections: {} }));
      // Fetch package details
      if (value) {
        fetchPackageDetails(value);
      } else {
        setPackageCategories([]);
        setCategoryMenuItems({});
        setSelectedPackageInfo(null);
      }
    }
  };

  const handleMenuSelectionChange = (categoryId, menuItemId) => {
    setEditFormData(prev => ({
      ...prev,
      menu_selections: { ...prev.menu_selections, [categoryId]: menuItemId },
    }));
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setEditFieldErrors({});

    if (isPaymentLedgerLocked(booking.booking_status)) {
      toast.error(bookingEditLockedMessage(booking.booking_status));
      setIsSubmitting(false);
      return;
    }

    if (!editFormData.venue || editFormData.venue.trim() === '') {
      toast.error('Please enter a venue.');
      setEditFieldErrors({ venue: 'Please enter a venue.' });
      setIsSubmitting(false);
      return;
    }
    if (!editFormData.pax_count || parseInt(editFormData.pax_count) < 1) {
      toast.error('Please enter a valid pax count (must be at least 1).');
      setEditFieldErrors({ pax_count: 'Must be at least 1.' });
      setIsSubmitting(false);
      return;
    }
    if (!editFormData.total_amount || parseFloat(editFormData.total_amount) <= 0) {
      toast.error('Total amount must be greater than zero.');
      setEditFieldErrors({ total_amount: 'Must be greater than zero.' });
      setIsSubmitting(false);
      return;
    }
    if (editFormData.event_datetime) {
      const eventDate = new Date(editFormData.event_datetime);
      const now = new Date();
      const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const diffDays = Math.round((eventDay - today) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        toast.error('The event date cannot be in the past. Please choose today or a later date.');
        setEditFieldErrors({ event_datetime: 'This date has already passed.' });
        setIsSubmitting(false);
        return;
      } else if (diffDays < 3) {
        // Same hard block as the Bookings list page's Add/Edit form — this
        // Details-page edit form never had it, so editing a booking's date
        // here could silently violate PG's 3-day notice policy.
        toast.error('Bookings must be made at least 3 days before the event date — this is PG\'s catering policy.');
        setEditFieldErrors({ event_datetime: 'Must be at least 3 days from today.' });
        setIsSubmitting(false);
        return;
      }
    }

    try {
      const oldPackageId = booking.package_id;
      const newPackageId = editFormData.package_id;
      const packageChanged = newPackageId && newPackageId !== oldPackageId;
      const newPaxCount = parseInt(editFormData.pax_count) || 0;
      const paxChanged = newPaxCount !== (booking.pax_count || 0);
      // Whichever package is actually in effect after this save — needed so
      // a pax-only change (package unchanged) still knows what to re-allocate against.
      const effectivePackageId = newPackageId || oldPackageId;
      const shouldReallocateEquipment = !!effectivePackageId && (packageChanged || paxChanged);

      if (packageChanged || paxChanged) {
        const shouldContinue = await showConfirm({
          title: packageChanged ? 'Package Changed' : 'Guest Count Changed',
          message: packageChanged
            ? 'You have changed the package. Equipment assignments will be re‑allocated based on the new package. Continue?'
            : 'You have changed the guest count. Equipment assignments will be recalculated to match. Continue?',
          confirmLabel: 'Continue',
          confirmVariant: 'warning',
        });
        if (!shouldContinue) {
          setIsSubmitting(false);
          return;
        }
      }

      const payload = {
        customer_id: editFormData.customer_id,
        package_id: editFormData.package_id,
        booking_type: 'Package',
        event_datetime: editFormData.event_datetime ? new Date(editFormData.event_datetime).toISOString() : null,
        venue: editFormData.venue,
        pax_count: parseInt(editFormData.pax_count) || 0,
        motif_color: editFormData.motif_color || null,
        notes: editFormData.notes || null,
        total_amount: parseFloat(editFormData.total_amount) || 0,
        delivery_fee: parseFloat(editFormData.delivery_fee) || 0,
        menu_selections: editFormData.menu_selections,
      };

      const { error } = await supabase
        .from('booking')
        .update(payload)
        .eq('booking_id', id);
      if (error) throw error;

      // --- Re‑allocate equipment if the package or the guest count changed ---
      // (guest count matters because Countable equipment quantities are
      // computed from pax_count — leaving old equipment in place after a
      // pax change would silently under/over-provision the event)
      if (shouldReallocateEquipment) {
        // Delete existing equipment assignments for this booking
        await supabase.from('booking_equipment').delete().eq('booking_id', id);
        // Allocate equipment based on the (possibly new) package and pax count
        try {
          await allocateEquipmentForBooking(id, effectivePackageId, newPaxCount);
          toast.success('Equipment re‑allocated successfully.');
        } catch (allocError) {
          console.warn('Equipment re‑allocation warning:', allocError);
          toast('Equipment re‑allocation had issues: ' + allocError.message, { icon: '⚠️' });
        }
      }

      setIsEditModalOpen(false);
      toast.success('Booking updated successfully!');
      fetchBooking();
    } catch (error) {
      console.error(error);
      toast.error('Failed to update booking.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Equipment Assignment Handlers (unique) ---
  const openAssignEquipModal = () => {
    if (isPaymentLedgerLocked(booking.booking_status)) {
      toast.error(`Equipment can't be assigned anymore — this booking is ${booking.booking_status}.`);
      return;
    }
    const fetchEquipmentList = async () => {
      try {
        const { data, error } = await supabase
          .from('equipment')
          .select('equipment_id, eqm_name, quantity_available, equipment_type')
          .order('eqm_name');
        if (error) throw error;
        setEquipmentList(data || []);
      } catch (error) {
        console.error('Error fetching equipment list:', error);
        toast.error('Unable to load equipment list.');
      }
    };
    fetchEquipmentList();
    setAssignEquipData({ equipment_id: '', quantity: 1, notes: '' });
    setEquipSearchTerm('');
    setIsAssignEquipModalOpen(true);
  };

  const handleAssignEquipChange = (e) => {
    const { name, value } = e.target;
    setAssignEquipData(prev => ({
      ...prev,
      [name]: name === 'quantity' ? parseInt(value) || 1 : value,
    }));
  };

  const handleAssignEquipSubmit = async (e) => {
    e.preventDefault();

    if (!assignEquipData.equipment_id) {
      toast.error('Please select an equipment item.');
      return;
    }
    const quantity = assignEquipData.quantity;
    if (!quantity || quantity < 1) {
      toast.error('Quantity must be at least 1.');
      return;
    }

    setIsAssignSubmitting(true);
    try {
      const selectedEquip = equipmentList.find(eq => eq.equipment_id === assignEquipData.equipment_id);
      if (!selectedEquip) throw new Error('Equipment not found');

      // Quantity-aware stock check — equipment isn't exclusive to one event
      // per day, there's just a finite amount of it in total. Same check
      // the Edit Equipment flow does for a quantity increase; this Assign
      // flow never had it, so a fresh assignment could silently oversell
      // the equipment for the date.
      if (booking?.event_datetime) {
        const eventDate = new Date(booking.event_datetime);
        const { data: otherAssignments, error: otherError } = await supabase
          .from('booking_equipment')
          .select('quantity, booking:booking_id (event_datetime)')
          .eq('equipment_id', assignEquipData.equipment_id)
          .eq('returned', false);
        if (otherError) throw otherError;

        const alreadyCommitted = (otherAssignments || [])
          .filter(a => a.booking?.event_datetime && new Date(a.booking.event_datetime).toDateString() === eventDate.toDateString())
          .reduce((sum, a) => sum + (a.quantity || 0), 0);

        const totalNeeded = alreadyCommitted + quantity;
        if (totalNeeded > selectedEquip.quantity_available) {
          toast.error(
            `"${selectedEquip.eqm_name}": ${alreadyCommitted} already committed to other events on ${eventDate.toLocaleDateString()}, ` +
            `plus ${quantity} requested exceeds the ${selectedEquip.quantity_available} in stock.`
          );
          setIsAssignSubmitting(false);
          return;
        }
      }

      const { error: insertError } = await supabase
        .from('booking_equipment')
        .insert([{
          booking_id: id,
          equipment_id: assignEquipData.equipment_id,
          quantity,
          notes: assignEquipData.notes || null,
          returned: false,
        }]);
      if (insertError) throw insertError;

      setIsAssignEquipModalOpen(false);
      fetchBooking();
      toast.success('Equipment assigned successfully!');
    } catch (error) {
      console.error(error);
      toast.error('Failed to assign equipment.');
    } finally {
      setIsAssignSubmitting(false);
    }
  };

  const handleRemoveEquipment = async (assignmentId) => {
    if (isPaymentLedgerLocked(booking.booking_status)) {
      toast.error(`Equipment can't be removed anymore — this booking is ${booking.booking_status}.`);
      return;
    }
    const confirmed = await showConfirm({
      title: 'Remove Equipment?',
      message: 'Are you sure you want to remove this equipment assignment? This action cannot be undone.',
      confirmLabel: 'Remove',
      confirmVariant: 'warning',
    });
    if (!confirmed) return;

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: 'Removing this equipment assignment is permanent. Re-enter your password to continue.',
    });
    if (!passwordOk) return;

    try {
      const { error: deleteError } = await supabase
        .from('booking_equipment')
        .delete()
        .eq('assignment_id', assignmentId);
      if (deleteError) throw deleteError;
      fetchBooking();
      toast.success('Equipment removed.');
    } catch (error) {
      console.error(error);
      toast.error('Failed to remove equipment.');
    }
  };

  // --- Edit Equipment Assignment ---
  const openEditEquipModal = (assignment) => {
    if (isPaymentLedgerLocked(booking.booking_status)) {
      toast.error(`Equipment can't be edited anymore — this booking is ${booking.booking_status}.`);
      return;
    }
    setEditingAssignment(assignment);
    setEditEquipData({ quantity: assignment.quantity });
    setIsEditEquipModalOpen(true);
  };

  const handleEditEquipSubmit = async (e) => {
    e.preventDefault();
    setIsAssignSubmitting(true);

    const newQuantity = editEquipData.quantity;
    if (!newQuantity || newQuantity < 1) {
      toast.error('Quantity must be at least 1.');
      setIsAssignSubmitting(false);
      return;
    }
    // Quantity can only go up from here, never down — lowering it below what
    // was already allocated could leave the event short on the day, and the
    // "remove" action already covers taking equipment off the booking
    // entirely if it's genuinely no longer needed.
    if (newQuantity < editingAssignment.quantity) {
      toast.error(`Quantity can't be lowered below what's already allocated (${editingAssignment.quantity}). Remove the assignment instead if less is needed.`);
      setIsAssignSubmitting(false);
      return;
    }

    try {
      // Quantity-aware stock check — equipment isn't exclusive to one
      // event per day, there's just a finite amount of it in total. Same
      // check the Assign Equipment flow already does; this edit path
      // never had it, so bumping a quantity up here could silently
      // oversell the equipment for the date.
      const { data: equipRow, error: equipError } = await supabase
        .from('equipment')
        .select('quantity_available, eqm_name')
        .eq('equipment_id', editingAssignment.equipment_id)
        .maybeSingle();
      if (equipError) throw equipError;

      if (equipRow && booking?.event_datetime) {
        const eventDate = new Date(booking.event_datetime);
        const { data: otherAssignments, error: otherError } = await supabase
          .from('booking_equipment')
          .select('quantity, booking:booking_id (event_datetime)')
          .eq('equipment_id', editingAssignment.equipment_id)
          .eq('returned', false)
          .neq('assignment_id', editingAssignment.assignment_id);
        if (otherError) throw otherError;

        const alreadyCommitted = (otherAssignments || [])
          .filter(a => a.booking?.event_datetime && new Date(a.booking.event_datetime).toDateString() === eventDate.toDateString())
          .reduce((sum, a) => sum + (a.quantity || 0), 0);

        const totalNeeded = alreadyCommitted + newQuantity;
        if (totalNeeded > equipRow.quantity_available) {
          toast.error(
            `"${equipRow.eqm_name}": ${alreadyCommitted} already committed to other events on ${eventDate.toLocaleDateString()}, ` +
            `plus ${newQuantity} requested exceeds the ${equipRow.quantity_available} in stock.`
          );
          setIsAssignSubmitting(false);
          return;
        }
      }

      const { error } = await supabase
        .from('booking_equipment')
        .update({ quantity: newQuantity })
        .eq('assignment_id', editingAssignment.assignment_id);
      if (error) throw error;
      setIsEditEquipModalOpen(false);
      fetchBooking();
      toast.success('Equipment quantity updated.');
    } catch (error) {
      console.error(error);
      toast.error('Failed to update equipment.');
    } finally {
      setIsAssignSubmitting(false);
    }
  };

  // --- Render helpers ---
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
        className="w-8 h-8 rounded border border-slate-200 overflow-hidden hover:shadow-md transition-shadow cursor-pointer flex items-center justify-center bg-slate-50"
        title="Click to view proof"
      >
        <img
          src={fullUrl}
          alt="Payment proof"
          className="w-full h-full object-cover"
          onError={(e) => {
            e.target.style.display = 'none';
            const parent = e.target.parentElement;
            const fallback = document.createElement('div');
            fallback.className = 'w-full h-full flex items-center justify-center text-slate-400';
            fallback.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>`;
            parent.appendChild(fallback);
          }}
        />
      </button>
    );
  };

  // --- RENDER ---
  if (loading) return <div className="p-12 text-center text-slate-500 font-medium">Loading...</div>;
  if (!booking) return <div className="p-12 text-center text-slate-500">Booking not found.</div>;

  // --- PAYMENT CALCULATIONS (including Cancelled) ---
  // `positivePayments` stays a gross figure (money paid in, ignoring
  // refunds) — the refund-eligibility math below (refundableBase,
  // remainingRefundableAmount, refundStatus, Cancel modal's maxRefundable)
  // all depend on that gross number. `netPaid` is refunds netted out, used
  // only where the UI is showing "how much does the customer actually have
  // paid in right now" (the Total Paid stat).
  const positivePayments = sumVerifiedPositivePayments(payments);
  const totalRefunded = payments
    .filter(p => p.amount_paid < 0)
    .reduce((sum, p) => sum + Math.abs(p.amount_paid), 0);
  const netPaid = Math.max(0, positivePayments - totalRefunded);

  let remainingBalance = Math.max(0, (booking.total_amount || 0) - positivePayments);
  if (booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled') remainingBalance = 0;

  const downpaymentPaid = sumVerifiedDownpayments(payments);

  const eventDate = booking.event_datetime ? new Date(booking.event_datetime) : null;
  const now = new Date();
  let daysUntilEvent = null;
  let isRefundable = false;
  if (eventDate) {
    const diffTime = eventDate.getTime() - now.getTime();
    daysUntilEvent = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    isRefundable = daysUntilEvent >= 3;
  }

  let remainingRefundableAmount = 0;
  if (booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled') {
    if (eventDate && daysUntilEvent !== null && daysUntilEvent < 3) {
      const refundableBase = Math.max(0, positivePayments - downpaymentPaid);
      remainingRefundableAmount = Math.max(0, refundableBase - totalRefunded);
    } else {
      remainingRefundableAmount = Math.max(0, positivePayments - totalRefunded);
    }
  }

  let refundStatus = null;
  if (positivePayments > 0 && (booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled')) {
    if (totalRefunded >= positivePayments) {
      refundStatus = 'Fully Refunded';
    } else if (isRefundable) {
      refundStatus = 'Refundable';
    } else {
      refundStatus = 'Non-Refundable';
    }
  }

  // Cancellation only opens up once the event is genuinely locked in
  // (Confirmed) — not while it's merely Approved-but-unpaid.
  const canCancel = booking.booking_status === 'Confirmed';
  const showAddRefund = (booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled') && remainingRefundableAmount > 0;
  // Payments only open up once a booking has been approved (Updated Flow:
  // Pending -> Approve/Reject -> Proceed to Payment). Confirmed/Completed
  // bookings can still take a late/final payment.
  const canRecordPayment = ['Approved', 'Confirmed', 'Completed'].includes(booking.booking_status);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/app/bookings')}
            className="w-10 h-10 bg-white border border-slate-300 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors shadow-xs"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {booking.customer?.first_name} {booking.customer?.last_name}
            </h1>
            <p className="text-xs text-slate-500">Booking #: {booking.booking_number || booking.booking_id.slice(0, 8)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {booking.booking_status === 'Pending' && (
            <>
              <button onClick={() => openApprovalModal(booking, 'package')} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm">
                <Check size={18} /> Approve
              </button>
              <button onClick={() => openRejectionModal(booking.booking_id)} className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm">
                <X size={18} /> Reject
              </button>
            </>
          )}
          {canConfirmBooking && (
            <button
              onClick={handleConfirmBooking}
              disabled={isConfirming}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm disabled:opacity-50"
            >
              <Check size={18} /> {isConfirming ? 'Confirming...' : 'Confirm Event'}
            </button>
          )}
          {canMarkCompleted && (
            <button
              onClick={handleMarkCompleted}
              disabled={isCompleting}
              className={isCompletionFullyPaid ? 'bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm disabled:opacity-50' : 'bg-white border border-slate-300 text-slate-500 font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors'}
              title={isCompletionFullyPaid ? undefined : `Locked — ₱${completionRemainingBalance.toLocaleString()} still owed`}
            >
              {isCompletionFullyPaid ? <Check size={18} /> : <Lock size={18} />} {isCompleting ? 'Completing...' : 'Mark Completed'}
            </button>
          )}
          {canCancel && (
            <button
              onClick={openCancelModal}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
            >
              <X size={18} /> Cancel Booking
            </button>
          )}
          {showAddRefund && (
            <button
              onClick={openRefundModal}
              className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
            >
              Add Refund
            </button>
          )}
          <button
            onClick={openEditModal}
            className={isPaymentLedgerLocked(booking.booking_status) ? 'bg-white border border-slate-300 text-slate-400 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors' : 'bg-white border border-slate-300 text-slate-700 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors'}
            title={isPaymentLedgerLocked(booking.booking_status) ? bookingEditLockedMessage(booking.booking_status) : undefined}
          >
            {isPaymentLedgerLocked(booking.booking_status) ? <Lock size={16} /> : <Edit size={16} />} Edit
          </button>
          <button
            onClick={handleDelete}
            className="bg-white border border-red-300 text-red-600 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-red-50 transition-colors"
            title="Permanently delete this booking (password required)"
          >
            <Trash2 size={16} /> Delete
          </button>
          <button onClick={fetchBooking} className="bg-white border border-slate-300 text-slate-700 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Status Badge + Refund Indicator */}
      <div className="flex items-center gap-3">
        <span className={`px-4 py-1.5 rounded-full text-xs font-bold border ${(
          booking.booking_status === 'Pending' ? 'bg-amber-50 border-amber-200 text-amber-700' :
          booking.booking_status === 'Approved' ? 'bg-[#EAF3F2] border-[#C1DEDC] text-slate-800' :
          booking.booking_status === 'Confirmed' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
          booking.booking_status === 'Completed' ? 'bg-blue-50 border-blue-200 text-blue-700' :
          booking.booking_status === 'Cancelled' ? 'bg-slate-100 border-slate-300 text-slate-600' :
          'bg-red-50 border-red-200 text-red-700'
        )}`}>
          {booking.booking_status}
        </span>

        {hasUnpaidPastEvent({ booking_status: booking.booking_status, event_datetime: booking.event_datetime, total_amount: booking.total_amount, positivePayments }) && (
          <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-red-50 border-red-200 text-red-700">
            Past Event — ₱{remainingBalance.toLocaleString()} Remaining
          </span>
        )}

        {/* Refund status indicator for rejected/cancelled bookings with payments */}
        {refundStatus === 'Fully Refunded' && (
          <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-blue-50 border-blue-200 text-blue-700">
            Fully Refunded
          </span>
        )}
        {refundStatus === 'Refundable' && (
          <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-green-50 border-green-200 text-green-700">
            Refundable
          </span>
        )}
        {refundStatus === 'Non-Refundable' && (
          <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-red-50 border-red-200 text-red-700">
            Non-Refundable
          </span>
        )}

        {/* ✅ NEW: Show balance remaining for completed bookings */}
{booking.booking_status === 'Completed' && positivePayments < (booking.total_amount || 0) && (
  <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-amber-50 border-amber-200 text-amber-700">
    Balance Remaining
  </span>
)}
      </div>

      {/* Mobile payment(s) awaiting verification — a manually recorded
          payment is verified by definition, so this only ever fires for
          something the customer submitted from the app that needs a
          manager's eyes on the proof. */}
      {payments.some(p => p.pay_status === 'Pending Verification') && (
        <div className="relative overflow-hidden rounded-xl border-2 border-red-300 bg-red-50 p-4 flex items-center gap-3">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-bold text-red-800">
              {payments.filter(p => p.pay_status === 'Pending Verification').length} payment{payments.filter(p => p.pay_status === 'Pending Verification').length > 1 ? 's' : ''} awaiting verification
            </p>
            <p className="text-xs text-red-600">Submitted from the mobile app — review the proof below and Verify or Reject it.</p>
          </div>
        </div>
      )}

      {/* Day / Equipment Availability — any Pending booking, same shared layout as the Approve modal */}
      {booking.booking_status === 'Pending' && booking.event_datetime && (
        <ApprovalAvailabilityCheck
          booking={booking}
          effectivePaxCount={booking.pax_count || 0}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Event Details</h3>
            <div className="space-y-2.5 text-sm">
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Created</span>
                <span className="col-span-2">
                  {booking.book_datetime ? new Date(booking.book_datetime).toLocaleString() : 'N/A'}
                </span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Event Date</span>
                <span className="col-span-2">
                  {booking.event_datetime ? new Date(booking.event_datetime).toLocaleString() : 'N/A'}
                </span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Venue</span>
                <span className="col-span-2">{booking.venue || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Pax</span>
                <span className="col-span-2">{booking.pax_count}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Package</span>
                <span className="col-span-2">{booking.package?.pkg_name || 'None'}</span>
              </div>
              {booking.package && (
                <div className="grid grid-cols-3">
                  <span className="text-slate-700 font-bold">Pricing</span>
                  <span className="col-span-2">
                    {booking.package.pricing_type === 'fixed' ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full border border-purple-200">Fixed</span>
                        <span className="font-semibold">₱{booking.package.pkg_price?.toLocaleString()}</span>
                        {booking.package.max_pax && (
                          <span className="text-xs text-slate-500">(up to {booking.package.max_pax} pax)</span>
                        )}
                        {booking.package.extra_pax_price > 0 && (
                          <span className="text-xs text-slate-500">· ₱{booking.package.extra_pax_price}/extra pax</span>
                        )}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full border border-blue-200">Per Pax</span>
                        <span className="font-semibold">₱{booking.package.pkg_price?.toLocaleString()}</span>
                        <span className="text-xs text-slate-500">/pax</span>
                      </span>
                    )}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Motif Color</span>
                <span className="col-span-2">{booking.motif_color || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-3 border-t border-slate-200 pt-2 mt-1">
                <span className="text-slate-700 font-bold">Total Amount</span>
                <span className="col-span-2 font-bold text-[#008A45]">₱{booking.total_amount?.toLocaleString() || '0'}</span>
              </div>
            </div>
            {booking.notes && (
              <div className="pt-4 mt-4 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-900 block mb-1">Notes</span>
                <p className="text-xs text-slate-500 whitespace-pre-wrap">{booking.notes}</p>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Client Details</h3>
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Name</span>
                <span className="col-span-2">{booking.customer?.first_name} {booking.customer?.last_name}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Contact</span>
                <span className="col-span-2">{booking.customer?.contact_no || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Email</span>
                <span className="col-span-2">{booking.customer?.email_address || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Address</span>
                <span className="col-span-2">{booking.customer?.cus_address || 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-7 space-y-6">
          {/* Payment Tracking */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-900">Payment Tracking</h3>
              {canRecordPayment && (
                <button
                  onClick={openPaymentModal}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <Plus size={14} /> Record Payment
                </button>
              )}
              {!canRecordPayment && booking.booking_status === 'Pending' && (
                <span className="text-xs text-slate-400 italic">Approve this booking to enable payments</span>
              )}
              {!canRecordPayment && (booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled') && (
                <span className="text-xs text-slate-400 italic">Payments closed</span>
              )}
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2 flex justify-between items-center text-sm">
              <span className="font-medium text-slate-700">Total Amount:</span>
              <span className="font-bold text-slate-900">₱{booking.total_amount?.toLocaleString() || '0'}</span>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2 flex justify-between items-center text-sm">
              <span className="font-medium text-slate-700">Downpayment Paid:</span>
              <span className="font-bold text-[#008A45]">₱{downpaymentPaid.toLocaleString()}</span>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2 flex justify-between items-center text-sm">
              <span className="font-medium text-slate-700">Total Paid:</span>
              <span className="font-bold text-[#008A45]">₱{netPaid.toLocaleString()}</span>
            </div>
            <div className={`rounded-lg p-3 flex justify-between items-center text-sm border ${
              remainingBalance <= 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
            }`}>
              <span className="font-medium text-slate-700">Remaining Balance:</span>
              <span className={`font-bold ${remainingBalance <= 0 ? 'text-green-700' : 'text-amber-700'}`}>
                {booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled'
                  ? `N/A — ${booking.booking_status}`
                  : `₱${remainingBalance.toLocaleString()}`}
              </span>
            </div>
            {payments.length > 0 && (
              <div className="mt-4 border border-slate-300 rounded-lg overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-[#EAF3F2] text-slate-900 font-bold border-b border-slate-300">
                      <th className="p-3">Amount</th>
                      <th className="p-3">Method</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Proof</th>
                      <th className="p-3">Date</th>
                      <th className="p-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-700">
                    {payments.map(p => {
                      const pendingVerification = p.pay_status === 'Pending Verification';
                      return (
                      <tr key={p.payment_id} className={p.amount_paid < 0 ? 'bg-red-50' : pendingVerification ? 'bg-blue-50' : ''}>
                        <td className={`p-3 font-bold ${p.amount_paid < 0 ? 'text-red-600' : ''}`}>
                          {p.amount_paid < 0 ? '-' : ''}₱{Math.abs(p.amount_paid).toLocaleString()}
                        </td>
                        <td className="p-3">{p.pay_method || 'N/A'}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            p.pay_status === 'Refunded' ? 'bg-red-100 text-red-700 border border-red-200' :
                            p.pay_status === 'Fully Paid' ? 'bg-green-100 text-green-700 border border-green-200' :
                            p.pay_status === 'Pending Verification' ? 'bg-blue-100 text-blue-700 border border-blue-200' :
                            p.pay_status === 'Proof Rejected' ? 'bg-red-100 text-red-700 border border-red-200' :
                            'bg-amber-100 text-amber-700 border border-amber-200'
                          }`}>
                            {p.pay_status || 'N/A'}
                          </span>
                        </td>
                        <td className="p-3">{renderProof(p.pay_proof)}</td>
                        <td className="p-3">{p.pay_datetime ? new Date(p.pay_datetime).toLocaleString() : 'N/A'}</td>
                        <td className="p-3 text-center">
                          <div className="flex justify-center gap-2">
                            {pendingVerification ? (
                              <>
                                <button onClick={() => openVerifyModal(p)} disabled={isVerifying} className="text-green-600 hover:text-green-800 disabled:opacity-50" title="Verify Payment">
                                  <Check size={14} />
                                </button>
                                <button onClick={() => openRejectProofModal(p)} disabled={isVerifying} className="text-red-500 hover:text-red-700 disabled:opacity-50" title="Reject Proof">
                                  <X size={14} />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => openEditPaymentModal(p)}
                                className={isPaymentLedgerLocked(booking.booking_status) ? 'text-slate-400 hover:text-slate-600' : 'text-blue-500 hover:text-blue-700'}
                                title={isPaymentLedgerLocked(booking.booking_status) ? `Locked — payments can't be edited once a booking is ${booking.booking_status}` : 'Edit Payment'}
                              >
                                {isPaymentLedgerLocked(booking.booking_status) ? <Lock size={14} /> : <Edit size={14} />}
                              </button>
                            )}
                            <button
                              onClick={() => handleDeletePayment(p.payment_id)}
                              className={isPaymentLedgerLocked(booking.booking_status) ? 'text-slate-400 hover:text-slate-600' : 'text-red-500 hover:text-red-700'}
                              title={isPaymentLedgerLocked(booking.booking_status) ? `Locked — payments can't be deleted once a booking is ${booking.booking_status}` : 'Delete Payment'}
                            >
                              {isPaymentLedgerLocked(booking.booking_status) ? <Lock size={14} /> : <Trash2 size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {/* Show refund status summary for rejected/cancelled bookings */}
            {(booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled') && positivePayments > 0 && (
              <div className="mt-4 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600">
                <p>
                  <span className="font-bold">Refund Status:</span>{' '}
                  {refundStatus === 'Fully Refunded' ? (
                    <span className="text-blue-600 font-medium">Fully refunded</span>
                  ) : remainingRefundableAmount > 0 ? (
                    <span className="text-green-600 font-medium">Partial refund available (₱{remainingRefundableAmount.toFixed(2)})</span>
                  ) : refundStatus === 'Non-Refundable' ? (
                    <span className="text-red-600 font-medium">Non-refundable per policy</span>
                  ) : (
                    <span className="text-slate-600">No payments</span>
                  )}
                </p>
                {refundStatus === 'Non-Refundable' && (
                  <p className="mt-1 text-red-500">Downpayment forfeited (event within 3 days)</p>
                )}
                {refundStatus === 'Fully Refunded' && (
                  <p className="mt-1 text-blue-500">All payments have been refunded.</p>
                )}
              </div>
            )}
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
              <div className="flex items-center gap-2">
                <button
                  onClick={openAssignEquipModal}
                  className={isPaymentLedgerLocked(booking.booking_status)
                    ? 'bg-slate-100 text-slate-400 font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors'
                    : 'bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors shadow-sm'}
                  title={isPaymentLedgerLocked(booking.booking_status) ? `Locked — equipment can't be assigned once a booking is ${booking.booking_status}` : undefined}
                >
                  {isPaymentLedgerLocked(booking.booking_status) ? <Lock size={14} /> : <ClipboardList size={14} />} Assign Equipment
                </button>
                <span className="text-xs font-medium text-slate-500">{equipment.length} item{equipment.length !== 1 ? 's' : ''}</span>
              </div>
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
                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${item.returned ? 'bg-green-100 border border-green-200 text-green-700' : 'bg-amber-100 border border-amber-200 text-amber-700'}`}>
                        {item.returned ? '✅ Returned' : '📌 Assigned'}
                      </span>
                      {!item.returned && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => openEditEquipModal(item)}
                            className={isPaymentLedgerLocked(booking.booking_status) ? 'text-slate-400 hover:text-slate-600' : 'text-blue-500 hover:text-blue-700'}
                            title={isPaymentLedgerLocked(booking.booking_status) ? `Locked — equipment can't be edited once a booking is ${booking.booking_status}` : 'Edit quantity'}
                          >
                            {isPaymentLedgerLocked(booking.booking_status) ? <Lock size={14} /> : <Edit size={14} />}
                          </button>
                          <button
                            onClick={() => handleRemoveEquipment(item.assignment_id)}
                            className={isPaymentLedgerLocked(booking.booking_status) ? 'text-slate-400 hover:text-slate-600' : 'text-red-400 hover:text-red-600'}
                            title={isPaymentLedgerLocked(booking.booking_status) ? `Locked — equipment can't be removed once a booking is ${booking.booking_status}` : 'Remove'}
                          >
                            {isPaymentLedgerLocked(booking.booking_status) ? <Lock size={14} /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== EDIT MODAL ===== */}
      {isEditModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Edit Booking</h2>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 overflow-y-auto space-y-5 text-left">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Customer *</label>
                <select
                  name="customer_id"
                  value={editFormData.customer_id}
                  onChange={handleEditInputChange}
                  required
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                >
                  <option value="">Select Customer</option>
                  {customers.map(c => (
                    <option key={c.customer_id} value={c.customer_id}>{c.first_name} {c.last_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Package *</label>
                <select
                  name="package_id"
                  value={editFormData.package_id}
                  onChange={handleEditInputChange}
                  required
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                >
                  <option value="">Select Package</option>
                  {packages.map(p => (
                    <option key={p.package_id} value={p.package_id}>
                      {p.pkg_name} {p.pricing_type === 'fixed' ? '(Fixed)' : '(Per Pax)'}
                    </option>
                  ))}
                </select>
                {editFormData.package_id !== booking.package_id && (
                  <p className="text-xs text-amber-600 mt-1">⚠️ Changing package will re‑allocate equipment and reset menu selections.</p>
                )}
              </div>

              {packageCategories.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-2">Menu Selections</label>
                  <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
                    {packageCategories.map(cat => {
                      const items = categoryMenuItems[cat.category_id] || [];
                      const selected = editFormData.menu_selections[cat.category_id] || '';
                      return (
                        <div key={cat.category_id} className="flex items-center gap-4">
                          <span className="w-32 text-sm font-bold text-slate-700">{cat.category_name}</span>
                          <select
                            value={selected}
                            onChange={(e) => handleMenuSelectionChange(cat.category_id, e.target.value)}
                            className="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                            required
                          >
                            <option value="">Select Menu Item</option>
                            {items.map(item => (
                              <option key={item.menu_item_id} value={item.menu_item_id}>{item.menu_name}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Choose one menu item per category.</p>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Event Date & Time</label>
                <DateTimePicker
                  name="event_datetime"
                  value={editFormData.event_datetime}
                  onChange={handleEditInputChange}
                  hasError={!!editFieldErrors.event_datetime}
                  minLeadDays={3}
                />
                {editFieldErrors.event_datetime && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.event_datetime}</p>}
                <p className="text-[11px] text-slate-400 mt-1">Bookings must be made at least 3 days before the event — PG's catering policy.</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Venue</label>
                <input
                  type="text"
                  name="venue"
                  value={editFormData.venue}
                  onChange={handleEditInputChange}
                  placeholder="e.g. Grand Pavilion"
                  className={errorInputClass(!!editFieldErrors.venue, 'w-full border rounded-lg p-2.5 text-sm outline-none')}
                />
                {editFieldErrors.venue && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.venue}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Pax Count</label>
                  <input
                    type="number"
                    name="pax_count"
                    value={editFormData.pax_count}
                    onChange={handleEditInputChange}
                    placeholder="e.g. 80"
                    className={errorInputClass(!!editFieldErrors.pax_count, 'w-full border rounded-lg p-2.5 text-sm outline-none')}
                  />
                  {editFieldErrors.pax_count && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.pax_count}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Motif Color</label>
                  <input
                    type="text"
                    name="motif_color"
                    value={editFormData.motif_color}
                    onChange={handleEditInputChange}
                    placeholder="e.g. Burgundy"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Total Amount (auto-calculated)</label>
                  <input
                    type="number"
                    name="total_amount"
                    value={editFormData.total_amount}
                    placeholder="Auto-calculated"
                    disabled
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none bg-slate-50 text-slate-600"
                  />
                  {editFieldErrors.total_amount && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.total_amount}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Delivery Fee</label>
                  <input
                    type="number"
                    name="delivery_fee"
                    value={editFormData.delivery_fee}
                    onChange={handleEditInputChange}
                    placeholder="0.00"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notes</label>
                <textarea
                  name="notes"
                  value={editFormData.notes}
                  onChange={handleEditInputChange}
                  rows="2"
                  placeholder="Special instructions..."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45] resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Update Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===== ASSIGN EQUIPMENT MODAL ===== */}
      {isAssignEquipModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Assign Equipment to Booking</h2>
              <button
                onClick={() => setIsAssignEquipModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAssignEquipSubmit} className="p-6 space-y-5 text-left">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm">
                <p><span className="font-medium">Booking:</span> {booking.booking_number || `BKG-${booking.booking_id.slice(0, 8)}`} – {booking.customer?.first_name} {booking.customer?.last_name}</p>
                <p className="text-xs text-slate-500 mt-1">Equipment will be assigned to this booking only.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Select Equipment</label>
                  <div className="relative mb-1.5">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                    <input
                      type="text"
                      placeholder="Search equipment..."
                      value={equipSearchTerm}
                      onChange={(e) => setEquipSearchTerm(e.target.value)}
                      className="w-full pl-7 pr-2 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                    />
                  </div>
                  <select
                    name="equipment_id"
                    value={assignEquipData.equipment_id}
                    onChange={handleAssignEquipChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none font-medium text-slate-800"
                    required
                  >
                    <option value="">Choose equipment...</option>
                    {equipmentList
                      .filter(eq => eq.eqm_name.toLowerCase().includes(equipSearchTerm.toLowerCase()))
                      .map((eq) => (
                        <option key={eq.equipment_id} value={eq.equipment_id}>
                          {eq.eqm_name} — {eq.quantity_available} in stock{eq.equipment_type === 'Decoration' ? ' (Decoration)' : ''}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Quantity</label>
                  <input
                    type="number"
                    name="quantity"
                    min="1"
                    value={assignEquipData.quantity}
                    onChange={handleAssignEquipChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Notes (optional)</label>
                <textarea
                  name="notes"
                  rows="2"
                  placeholder="Any special instructions..."
                  value={assignEquipData.notes}
                  onChange={handleAssignEquipChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-700 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAssignEquipModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAssignSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isAssignSubmitting ? 'Assigning...' : 'Assign Equipment'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===== RECORD PAYMENT MODAL ===== */}
      {isPaymentModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Record Payment</h2>
              <button
                onClick={() => setIsPaymentModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handlePaymentSubmit} className="p-6 overflow-y-auto space-y-6 text-left">
              <div className="bg-[#F8F9FA] border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
                <h4 className="font-bold text-slate-900 text-sm mb-2">Booking Details</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <span className="text-slate-600 font-medium">Customer:</span>
                  <span className="text-slate-900 font-semibold">
                    {booking.customer ? `${booking.customer.first_name} ${booking.customer.last_name}` : 'Unknown'}
                  </span>
                  <span className="text-slate-600 font-medium">Type:</span>
                  <span className="text-slate-900 font-semibold">{booking.booking_type || 'N/A'}</span>
                  <span className="text-slate-600 font-medium">Venue:</span>
                  <span className="text-slate-900 font-semibold">{booking.venue || 'N/A'}</span>
                  <span className="text-slate-600 font-medium">Event Date:</span>
                  <span className="text-slate-900 font-semibold">
                    {booking.event_datetime ? new Date(booking.event_datetime).toLocaleString() : 'N/A'}
                  </span>
                  <span className="text-slate-600 font-medium">Total Amount:</span>
                  <span className="text-slate-900 font-bold text-[#008A45]">
                    ₱{booking.total_amount?.toLocaleString() || '0'}
                  </span>
                  <span className="text-slate-600 font-medium">Paid:</span>
                  <span className="text-slate-900 font-semibold">₱{positivePayments.toLocaleString()}</span>
                  <span className="text-slate-600 font-medium">Remaining:</span>
                  <span className={`font-semibold ${remainingBalance <= 0 ? 'text-green-700' : 'text-amber-700'}`}>
                    ₱{remainingBalance.toLocaleString()}
                  </span>
                  <span className="text-slate-600 font-medium">Status:</span>
                  <span className="text-slate-900 font-semibold capitalize">{booking.booking_status || 'N/A'}</span>
                  <span className="text-slate-600 font-medium">First Payment?</span>
                  <span className="text-slate-900 font-semibold">{positivePayments === 0 ? '✅ Yes' : 'No'}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Amount (₱)</label>
                  <input
                    type="number"
                    name="amount"
                    value={paymentFormData.amount}
                    onChange={handlePaymentInputChange}
                    placeholder="0.00"
                    step="0.01"
                    required
                    className={`w-full border rounded-lg p-2.5 text-sm focus:ring-2 outline-none ${paymentAmountError ? 'border-red-400 focus:ring-red-200 focus:border-red-400 bg-red-50/40' : 'border-slate-300 focus:ring-[#008A45]/20 focus:border-[#008A45]'}`}
                  />
                  {paymentAmountError && (
                    <p className="text-xs text-red-600 mt-1 font-semibold">{paymentAmountError}</p>
                  )}
                  {!paymentAmountError && (() => {
                    const isFirst = positivePayments === 0;
                    const status = paymentFormData.pay_status;
                    const total = booking.total_amount || 0;
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
                        hint = `Remaining balance to close: ₱${remainingBalance.toLocaleString()}.`;
                      } else {
                        hint = `You can enter any amount up to the remaining balance.`;
                      }
                    }
                    return hint ? <p className="text-xs text-blue-600 mt-1 font-medium">{hint}</p> : null;
                  })()}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Payment Status</label>
                  <select
                    name="pay_status"
                    value={paymentFormData.pay_status}
                    onChange={handlePaymentInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                  >
                    <option value="Downpayment">Downpayment</option>
                    <option value="Fully Paid">Fully Paid</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">Payment Method</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Cash', 'GCash', 'Bank Transfer'].map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentFormData(prev => ({ ...prev, pay_method: method }))}
                      className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-sm font-semibold transition-all ${paymentFormData.pay_method === method ? 'bg-[#CBDEDD]/60 border-[#008A45] text-slate-900 shadow-xs' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${paymentFormData.pay_method === method ? 'border-[#008A45]' : 'border-slate-400'}`}>
                        {paymentFormData.pay_method === method && <div className="w-1.5 h-1.5 rounded-full bg-[#008A45]" />}
                      </div>
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Proof of Payment</label>
                <label className={`border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center transition-colors cursor-pointer text-center relative overflow-hidden h-24 ${paymentFileError ? 'border-red-400 bg-red-50/40 hover:bg-red-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}>
                  <input type="file" onChange={handlePaymentFileChange} accept="image/*" className="hidden" />
                  <ImageIcon size={20} className={paymentFileError ? 'text-red-400 mb-1' : 'text-slate-400 mb-1'} />
                  <span className="text-xs font-semibold text-slate-600">{selectedFile ? selectedFile.name : 'Upload Image'}</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">PNG, JPG up to 5MB</span>
                </label>
                {paymentFileError ? (
                  <p className="text-xs text-red-600 mt-1 font-semibold">{paymentFileError}</p>
                ) : (
                  <p className="text-xs text-slate-400 mt-1">Upload a proof image; will be stored in Supabase Storage.</p>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={() => setIsPaymentModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button type="submit" disabled={isPaymentSubmitting || uploading} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50">
                  {uploading ? 'Uploading...' : (isPaymentSubmitting ? 'Saving...' : 'Record Payment')}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===== EDIT PAYMENT MODAL ===== */}
      {isEditPaymentModalOpen && editingPayment && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Edit Payment</h2>
              <button onClick={() => setIsEditPaymentModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleEditPaymentSubmit} className="p-6 overflow-y-auto space-y-6 text-left">
              <div className="bg-[#F8F9FA] border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
                <h4 className="font-bold text-slate-900 text-sm mb-2">Booking Details</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <span className="text-slate-600 font-medium">Customer:</span>
                  <span className="text-slate-900 font-semibold">{booking.customer ? `${booking.customer.first_name} ${booking.customer.last_name}` : 'Unknown'}</span>
                  <span className="text-slate-600 font-medium">Type:</span>
                  <span className="text-slate-900 font-semibold">{booking.booking_type || 'N/A'}</span>
                  <span className="text-slate-600 font-medium">Total Amount:</span>
                  <span className="text-slate-900 font-bold text-[#008A45]">₱{booking.total_amount?.toLocaleString() || '0'}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Amount (₱)</label>
                  <input type="number" name="amount" value={editPaymentFormData.amount} onChange={(e) => setEditPaymentFormData({...editPaymentFormData, amount: e.target.value})} placeholder="0.00" step="0.01" required className={`w-full border rounded-lg p-2.5 text-sm focus:ring-2 outline-none ${editAmountError ? 'border-red-400 focus:ring-red-200 focus:border-red-400 bg-red-50/40' : 'border-slate-300 focus:ring-[#008A45]/20 focus:border-[#008A45]'}`} />
                  {editAmountError && <p className="text-xs text-red-600 mt-1 font-semibold">{editAmountError}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Payment Status</label>
                  <select name="pay_status" value={editPaymentFormData.pay_status} onChange={(e) => setEditPaymentFormData({...editPaymentFormData, pay_status: e.target.value})} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white">
                    <option value="Downpayment">Downpayment</option>
                    <option value="Fully Paid">Fully Paid</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">Payment Method</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Cash', 'GCash', 'Bank Transfer'].map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setEditPaymentFormData(prev => ({ ...prev, pay_method: method }))}
                      className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-sm font-semibold transition-all ${editPaymentFormData.pay_method === method ? 'bg-[#CBDEDD]/60 border-[#008A45] text-slate-900 shadow-xs' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${editPaymentFormData.pay_method === method ? 'border-[#008A45]' : 'border-slate-400'}`}>
                        {editPaymentFormData.pay_method === method && <div className="w-1.5 h-1.5 rounded-full bg-[#008A45]" />}
                      </div>
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Proof of Payment</label>
                <label className={`border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center transition-colors cursor-pointer text-center relative overflow-hidden h-24 ${editFileError ? 'border-red-400 bg-red-50/40 hover:bg-red-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}>
                  <input type="file" onChange={(e) => setEditSelectedFile(e.target.files[0])} accept="image/*" className="hidden" />
                  <ImageIcon size={20} className={editFileError ? 'text-red-400 mb-1' : 'text-slate-400 mb-1'} />
                  <span className="text-xs font-semibold text-slate-600">{editSelectedFile ? editSelectedFile.name : 'Upload New Image'}</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">PNG, JPG up to 5MB</span>
                </label>
                {editFileError ? (
                  <p className="text-xs text-red-600 mt-1 font-semibold">{editFileError}</p>
                ) : editPaymentFormData.pay_proof !== 'placeholder.png' && !editSelectedFile ? (
                  <p className="text-xs text-slate-400 mt-1">Current proof: <a href={getProofUrl(editPaymentFormData.pay_proof)} target="_blank" className="text-blue-500 underline">View</a></p>
                ) : null}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={() => setIsEditPaymentModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button type="submit" disabled={isPaymentSubmitting || uploading} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50">
                  {uploading ? 'Uploading...' : (isPaymentSubmitting ? 'Saving...' : 'Update Payment')}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===== CANCEL BOOKING MODAL ===== */}
      {isCancelModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Cancel Booking</h2>
              <button
                onClick={() => setIsCancelModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className={`p-3 rounded-lg text-sm border ${eventDate && daysUntilEvent < 3 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                <p className="font-bold">Event Date: {eventDate ? new Date(eventDate).toLocaleString() : 'N/A'}</p>
                {eventDate && daysUntilEvent !== null && (
                  <p>{daysUntilEvent >= 0 ? `${daysUntilEvent} days until event` : 'Event has already passed'}</p>
                )}
                <p className="mt-1">Total paid: <span className="font-bold">₱{positivePayments.toLocaleString()}</span></p>

                {positivePayments > 0 ? (
                  <>
                    {eventDate && daysUntilEvent !== null && daysUntilEvent < 3 && daysUntilEvent >= 0 && (
                      <p className="font-bold mt-1 text-red-600">⚠️ Cancellation is within 3 days – downpayment is NON‑REFUNDABLE per policy.</p>
                    )}
                    {eventDate && daysUntilEvent !== null && daysUntilEvent >= 3 && (
                      <p className="font-bold mt-1 text-green-700">✅ Cancellation is 3+ days before event – downpayment IS refundable.</p>
                    )}
                    {!isRefundable && downpaymentPaid > 0 && (
                      <p className="mt-1 text-xs text-red-600">Downpayment (₱{downpaymentPaid.toLocaleString()}) will be forfeited.</p>
                    )}
                    {isRefundable && downpaymentPaid > 0 && (
                      <p className="mt-1 text-xs text-green-600">Downpayment is refundable as per policy.</p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">No payments have been made, so no refund is applicable.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Cancellation Reason *</label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows="3"
                  placeholder="e.g., Client cancelled, rescheduled, budget issues, etc."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                  required
                />
              </div>

{isRefundable && (() => {
  const maxRefundable = positivePayments; // since it's refundable, all payments are refundable
  return maxRefundable > 0 && (
    <div className="border-t border-slate-200 pt-3 mt-3">
      <p className="text-xs font-bold text-slate-700 mb-2">
        Record Refund Details <span className="font-normal text-slate-400">(optional – leave blank to skip)</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-0.5">Refund Amount (₱)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={refundAmount}
            onChange={(e) => setRefundAmount(e.target.value)}
            placeholder="Enter amount (optional)"
            className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none"
          />
          <p className="text-[10px] text-slate-400 mt-0.5">Max: ₱{positivePayments.toLocaleString()}</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-0.5">Remarks</label>
          <input
            type="text"
            value={refundRemarks}
            onChange={(e) => setRefundRemarks(e.target.value)}
            placeholder="Reason for refund"
            className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none"
          />
        </div>
      </div>
      <div className="mt-2">
        <label className="block text-xs font-semibold text-slate-600 mb-0.5">
          Receipt / Proof of Refund
          <span className="text-red-500 ml-1">*</span>
          <span className="font-normal text-slate-400 ml-1">(required if amount entered)</span>
        </label>
        <label className="border-2 border-dashed border-slate-300 rounded-lg p-2 flex items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-center">
          <input type="file" onChange={(e) => setRefundFile(e.target.files[0])} accept="image/*" className="hidden" />
          <span className="text-xs text-slate-600">{refundFile ? refundFile.name : 'Upload Image (required for refund)'}</span>
        </label>
      </div>
    </div>
  );
})()}

              {positivePayments > 0 && !isRefundable && downpaymentPaid > 0 && (
                <div className="border-t border-slate-200 pt-3 mt-3 text-xs text-slate-500">
                  <p>⚠️ This booking is <strong>non‑refundable</strong> because the event is less than 3 days away. The downpayment of ₱{downpaymentPaid.toLocaleString()} will be forfeited.</p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsCancelModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCancelBooking}
                  disabled={isCancelling}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                  {isCancelling ? 'Processing...' : 'Confirm Cancellation'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== EDIT EQUIPMENT QUANTITY MODAL ===== */}
      {isEditEquipModalOpen && editingAssignment && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Edit Equipment Quantity</h2>
              <button onClick={() => setIsEditEquipModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleEditEquipSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Equipment</label>
                <p className="text-sm font-medium text-slate-900">{editingAssignment.eqm_name}</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Quantity</label>
                <input type="number" min={editingAssignment.quantity} value={editEquipData.quantity} onChange={(e) => setEditEquipData({ quantity: parseInt(e.target.value) || 1 })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" required />
                <p className="text-[10px] text-slate-400 mt-0.5">Can't go below the currently allocated {editingAssignment.quantity}. Remove the assignment instead if less is needed.</p>
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setIsEditEquipModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button type="submit" disabled={isAssignSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50">
                  {isAssignSubmitting ? 'Updating...' : 'Update Quantity'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===== REJECTION REASON MODAL ===== */}
      {isRejectionModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Rejection Reason</h2>
              <button onClick={() => setIsRejectionModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Rejection *</label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows="3"
                  placeholder="e.g., Incomplete details, client requested cancellation, etc."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                  required
                />
                <p className="text-xs text-slate-400 mt-1">Reason is required.</p>
              </div>

              {showRejectionRefund && (
                <div className="border-t border-slate-200 pt-3 mt-3">
                  <p className="text-xs font-bold text-slate-700 mb-2">
                    Process Refund <span className="font-normal text-slate-400">(optional – leave blank to skip)</span>
                  </p>
                  <p className="text-xs text-slate-500 mb-2">Max refundable: ₱{rejectionMaxRefundable.toLocaleString()}</p>
                  <p className="text-xs text-red-500 mb-2">* Proof of refund is required if you enter an amount.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-0.5">Refund Amount (₱)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={rejectionRefundAmount}
                        onChange={(e) => setRejectionRefundAmount(e.target.value)}
                        placeholder="Enter amount (optional)"
                        className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-0.5">Remarks</label>
                      <input
                        type="text"
                        value={rejectionRefundRemarks}
                        onChange={(e) => setRejectionRefundRemarks(e.target.value)}
                        placeholder="Reason for refund"
                        className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-0.5">
                      Receipt / Proof of Refund <span className="text-red-500">*</span>
                      <span className="font-normal text-slate-400 ml-1">(required if amount entered)</span>
                    </label>
                    <label className="border-2 border-dashed border-slate-300 rounded-lg p-2 flex items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-center">
                      <input type="file" onChange={(e) => setRejectionRefundFile(e.target.files[0])} accept="image/*" className="hidden" />
                      <span className="text-xs text-slate-600">{rejectionRefundFile ? rejectionRefundFile.name : 'Upload Image (required for refund)'}</span>
                    </label>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsRejectionModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRejectConfirm}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== REFUND AFTER REJECTION/CANCELLATION MODAL ===== */}
      {isRefundModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Record Refund</h2>
              <button onClick={() => setIsRefundModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleRefundSubmit} className="p-6 space-y-4">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm">
                <p><span className="font-medium">Booking:</span> {booking.booking_number || `BKG-${booking.booking_id.slice(0, 8)}`} – {booking.customer?.first_name} {booking.customer?.last_name}</p>
                <p className="text-xs text-slate-500 mt-1">Refundable amount: ₱{remainingRefundableAmount.toLocaleString()}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Refund Amount (₱)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={refundModalAmount}
                  onChange={(e) => setRefundModalAmount(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:border-[#008A45] outline-none"
                  required
                />
                <p className="text-xs text-slate-400 mt-0.5">Max: ₱{remainingRefundableAmount.toLocaleString()}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Remarks</label>
                <input
                  type="text"
                  value={refundModalRemarks}
                  onChange={(e) => setRefundModalRemarks(e.target.value)}
                  placeholder="Reason for refund"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:border-[#008A45] outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Proof of Refund <span className="text-red-500">*</span>
                </label>
                <label className="border-2 border-dashed border-slate-300 rounded-lg p-4 flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-center relative overflow-hidden h-24">
                  <input type="file" onChange={(e) => setRefundModalFile(e.target.files[0])} accept="image/*" className="hidden" />
                  <ImageIcon size={20} className="text-slate-400 mb-1" />
                  <span className="text-xs font-semibold text-slate-600">{refundModalFile ? refundModalFile.name : 'Upload Image'}</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">PNG, JPG up to 5MB</span>
                </label>
                <p className="text-xs text-slate-400 mt-1">Proof image is required.</p>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setIsRefundModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button type="submit" disabled={isRefundSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50">
                  {isRefundSubmitting ? 'Processing...' : 'Record Refund'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===== APPROVAL MODAL ===== */}
      {isApprovalModalOpen && approvalBooking && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Approve Booking – Adjust Fees</h2>
              <button
                onClick={() => setIsApprovalModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6 text-left">
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="font-medium text-slate-600">Customer:</span>
                  <span className="font-bold text-slate-900">
                    {approvalBooking.customer?.first_name} {approvalBooking.customer?.last_name}
                  </span>
                  <span className="font-medium text-slate-600">Package:</span>
                  <span className="font-bold text-slate-900">{approvalBooking.package?.pkg_name}</span>
                  <span className="font-medium text-slate-600">Current Pax:</span>
                  <span className="font-bold text-slate-900">{approvalBooking.pax_count}</span>
                  <span className="font-medium text-slate-600">Current Total:</span>
                  <span className="font-bold text-slate-900">₱{approvalBooking.total_amount?.toLocaleString() || '0'}</span>
                </div>
                <p className="text-xs text-slate-500 mt-2">* Adjust extra pax or add fees below.</p>
              </div>

              <ApprovalAvailabilityCheck
                booking={approvalBooking}
                effectivePaxCount={(approvalBooking.pax_count || 0) + (approvalData.extraPax || 0)}
                onEquipmentStatusChange={setApprovalEquipmentStatus}
              />

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Extra Pax (additional headcount)</label>
                  <input
                    type="number"
                    name="extraPax"
                    min="0"
                    value={approvalData.extraPax}
                    onChange={handleApprovalInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">Each extra pax costs ₱{approvalBooking.package?.pkg_price || 0} (package price per pax).</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Other Fees (add-ons, extra services)</label>
                  <input
                    type="number"
                    name="additionalFee"
                    min="0"
                    step="0.01"
                    value={approvalData.additionalFee}
                    onChange={handleApprovalInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    placeholder="e.g. 2000"
                  />
                </div>
              </div>

              <div className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-lg p-4 flex justify-between items-center">
                <span className="font-bold text-slate-800">New Total:</span>
                <span className="text-xl font-extrabold text-[#008A45]">₱{approvalData.newTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              <div className="text-sm text-slate-500">
                <p>Down payment (50%): <span className="font-bold">₱{(approvalData.newTotal * 0.5).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></p>
                <p className="text-xs mt-1">* Down payment is required to secure the booking (non-refundable within 3 days of event).</p>
              </div>

              {approvalEquipmentStatus.applicable && !approvalEquipmentStatus.loading && !approvalEquipmentStatus.sufficient && (
                <p className="text-xs font-semibold text-red-600 text-right">
                  Can't approve — not enough {approvalEquipmentStatus.shortages.map(s => s.eqm_name).join(', ')} for this date.
                </p>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsApprovalModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleFinalizeApproval('package')}
                  disabled={approveDisabled}
                  title={approveDisabled && !isApprovalSubmitting ? 'Not enough equipment for this date' : undefined}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isApprovalSubmitting ? 'Approving...' : 'Confirm Approval & Update Total'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

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
              <p className="text-sm text-slate-600">Review the proof and confirm this payment is legitimate.</p>

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
                    <span className="font-semibold text-slate-900">₱{(booking?.total_amount || 0).toLocaleString()}</span>
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
                Rejecting the proof for the ₱{(rejectProofTarget.amount_paid || 0).toLocaleString()} payment submitted by the customer. They'll need to resubmit — let them know why.
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
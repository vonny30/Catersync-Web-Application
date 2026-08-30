// src/pages/ShortOrderDetails.jsx
import { useState, useEffect } from 'react';
import Select from '../components/Select';
import AssignVehicleModal from '../components/AssignVehicleModal';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, X, Plus, RefreshCw, Edit, Trash2, Lock, ClipboardList, Truck, AlertTriangle, Package as PackageIcon, Image as ImageIcon } from 'lucide-react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePasswordConfirm } from '../contexts/PasswordConfirmContext';
import { usePaymentHandlers } from '../hooks/usePaymentHandlers';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { useApprovalHandlers } from '../hooks/useApprovalHandlers';
import { useRejectionHandlers } from '../hooks/useRejectionHandlers';
import { useCancellationHandlers } from '../hooks/useCancellationHandlers';
import { useVerificationHandlers } from '../hooks/useVerificationHandlers';
import { useConfirmationHandlers } from '../hooks/useConfirmationHandlers';
import { useCompletionHandlers } from '../hooks/useCompletionHandlers';
import { sumVerifiedPositivePayments, sumVerifiedDownpayments, isPaymentLedgerLocked, describePaymentKind } from '../utils/payments';
import { getServiceMethod, reconcileServiceMethodChange, PICKUP_VENUE_MARKER, getDispatchWindow, TRIP_LEG } from '../utils/vehicle';
import { ACTIVE_BOOKING_STATUSES, bookingEditLockedMessage } from '../utils/bookingStatus';
import { autoCompletePastEvents, hasUnpaidPastEvent } from '../utils/autoComplete';
import ApprovalAvailabilityCheck from '../components/ApprovalAvailabilityCheck';
import { errorInputClass } from '../utils/formErrors';
import DateTimePicker from '../components/DateTimePicker';

export default function ShortOrderDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const { requestPasswordConfirm } = usePasswordConfirm();

  // --- State ---
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [isAssignVehicleOpen, setIsAssignVehicleOpen] = useState(false);
  const [menuItems, setMenuItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [menuSelections, setMenuSelections] = useState([]); // array of {menu_name, quantity}

  // --- Edit Modal state ---
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Field-level errors for the Edit Order form.
  const [editFieldErrors, setEditFieldErrors] = useState({});
  const [editFormData, setEditFormData] = useState({
    customer_id: '',
    event_datetime: '',
    venue: '',
    delivery_fee: '0',
    total_amount: '',
    notes: '',
    menu_selections: [], // [{menu_item_id, quantity}]
  });
  const [editTempItem, setEditTempItem] = useState({ menu_item_id: '', quantity: 1 });

  // --- Refund Modal state (local) ---
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const [refundModalAmount, setRefundModalAmount] = useState('');
  const [refundModalRemarks, setRefundModalRemarks] = useState('');
  const [refundModalFile, setRefundModalFile] = useState(null);
  const [isRefundSubmitting, setIsRefundSubmitting] = useState(false);

  // --- Proof Image Modal state ---
  const [isProofModalOpen, setIsProofModalOpen] = useState(false);
  const [proofModalUrl, setProofModalUrl] = useState('');

  // --- Fetch order data ---
  const fetchOrder = async () => {
    setLoading(true);
    try {
      const { data: orderData, error: orderError } = await supabase
        .from('booking')
        .select(`
          *,
          customer:customer_id (first_name, last_name, contact_no, cus_address, email_address, customer_id)
        `)
        .eq('booking_id', id)
        .eq('booking_type', 'Short Order')
        .maybeSingle();

      if (orderError) throw orderError;
      setOrder(orderData);
      if (!orderData) {
        // The row is gone -- deleted here or from the mobile app while this
        // page was open. That is an ordinary outcome for a link that outlived
        // its record, so it renders as "not found" rather than raising an
        // error toast. .single() would have made it a 406 and thrown.
        return;
      }

      if (orderData && !orderData.is_read) {
        await supabase.from('booking').update({ is_read: true }).eq('booking_id', id);
        setOrder(prev => ({ ...prev, is_read: true }));
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
      // runs whenever the details page is loaded — completes this order
      // if it's Confirmed, past its event date, and fully paid.
      const completedIds = await autoCompletePastEvents([{
        booking_id: orderData.booking_id,
        booking_status: orderData.booking_status,
        event_datetime: orderData.event_datetime,
        total_amount: orderData.total_amount,
        positivePayments: sumVerifiedPositivePayments(filtered),
      }]);
      if (completedIds.length > 0) {
        fetchOrder();
        return;
      }

      // Parse menu selections (array of {menu_item_id, quantity})
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
      // Fetch menu item names for display
      if (selections.length > 0) {
        const menuItemIds = selections.map(s => s.menu_item_id);
        const { data: menuData, error: menuError } = await supabase
          .from('menu_item')
          .select('menu_item_id, menu_name, menu_price')
          .in('menu_item_id', menuItemIds);
        if (!menuError && menuData) {
          const menuMap = Object.fromEntries(menuData.map(m => [m.menu_item_id, m]));
          const enriched = selections.map(s => ({
            ...s,
            menu_name: menuMap[s.menu_item_id]?.menu_name || 'Unknown',
            menu_price: menuMap[s.menu_item_id]?.menu_price || 0,
          }));
          setMenuSelections(enriched);
        } else {
          setMenuSelections(selections.map(s => ({ ...s, menu_name: 'Unknown', menu_price: 0 })));
        }
      } else {
        setMenuSelections([]);
      }
      // Dispatch — what is actually carrying this event. The page could
      // previously only mention a vehicle in its delete warning, so a manager
      // had to open Vehicles and search for the reference to answer "is there
      // a van for this?".
      const { data: dispatchData } = await supabase
        .from('vehicle_assign')
        .select('assignment_id, dispatch_datetime, assignment_status, vehicle:vehicle_id (plate_number, vehicle_type, vehicle_status)')
        .eq('booking_id', id)
        .order('dispatch_datetime', { ascending: true });
      setDispatches(dispatchData || []);

    } catch (error) {
      console.error(error);
      toast.error('Unable to load short order details.');
    } finally {
      setLoading(false);
    }
  };

  // --- Fetch dropdown data for edit modal ---
  useEffect(() => {
    fetchOrder();
    const fetchDropdownData = async () => {
      try {
        const { data: cust } = await supabase
          .from('customer')
          .select('customer_id, first_name, last_name')
          .eq('account_status', 'Active')
          .order('first_name');
        setCustomers(cust || []);
        const { data: menuData } = await supabase
          .from('menu_item')
          .select('menu_item_id, menu_name, menu_price')
          .eq('menu_availability', 'Available')
          .order('menu_name');
        setMenuItems(menuData || []);
      } catch (error) {
        console.error('Dropdown fetch error:', error);
      }
    };
    fetchDropdownData();
  }, [id]);

  // Scoped to THIS order with row filters — same reasoning as
  // BookingDetails: the status gates on this page are all derived from
  // booking_status, so acting on a stale copy is where the damage is.
  useRealtimeRefresh(
    `short-order-details-${id}`,
    [
      { table: 'booking', filter: `booking_id=eq.${id}` },
      { table: 'payment', filter: `booking_id=eq.${id}` },
      { table: 'booking_equipment', filter: `booking_id=eq.${id}` },
      { table: 'vehicle_assign', filter: `booking_id=eq.${id}` },
    ],
    fetchOrder,
    { enabled: !!id }
  );

  // ============================================================
  // HOOKS: Payment, Approval, Rejection, Cancellation
  // ============================================================

  // --- Payment Handlers ---
  const {
    isPaymentModalOpen,
    setIsPaymentModalOpen,
    paymentFormData,
    selectedFile,
    isPaymentSubmitting,
    uploading,
    paymentAmountError,
    paymentFileError,
    openPaymentModal,
    handlePaymentInputChange,
    handlePaymentFileChange,
    handlePaymentSubmit,
    getProofUrl,
    setPaymentFormData,
  } = usePaymentHandlers({
    bookingId: id,
    payments,
    totalAmount: order?.total_amount || 0,
    fetchData: fetchOrder,
    customerId: order?.customer_id,
  });

  // Approval Handlers (works for short orders as well)
  const {
    isApprovalModalOpen,
    setIsApprovalModalOpen,
    approvalBooking: approvalOrder,
    approvalData,
    isSubmitting: isApprovalSubmitting,
    openApprovalModal,
    handleApprovalInputChange,
    handleFinalizeApproval,
    setApprovalVehicleIds,
  } = useApprovalHandlers({
    booking: order,
    payments,
    fetchData: fetchOrder,
  });

  // --- Rejection Handlers (with wrapper functions) ---
  const getOrderBooking = (bookingId) => (bookingId === order?.booking_id ? order : null);
  const getPaymentSummary = (bookingId) => {
    if (bookingId === order?.booking_id) {
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
    getBooking: getOrderBooking,
    getPaymentSummary,
    fetchData: fetchOrder,
  });

  // Cancellation Handlers
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
    booking: order,
    payments,
    fetchData: fetchOrder,
  });

  // --- Confirmation Handlers (Approved -> Confirmed) ---
  const {
    canConfirmBooking,
    isConfirming,
    handleConfirmBooking,
  } = useConfirmationHandlers({
    booking: order,
    payments,
    fetchData: fetchOrder,
  });

  // --- Completion Handlers (Confirmed -> Completed) ---
  const {
    canMarkCompleted,
    isFullyPaid: isCompletionFullyPaid,
    remainingBalance: completionRemainingBalance,
    isCompleting,
    handleMarkCompleted,
  } = useCompletionHandlers({
    booking: order,
    payments,
    fetchData: fetchOrder,
    noun: 'order',
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
    totalAmount: order?.total_amount || 0,
    fetchData: fetchOrder,
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
          customer_id: order.customer_id,
          remarks: refundModalRemarks || 'Refund processed after rejection/cancellation',
        }]);
      if (refundError) throw refundError;

      const refundNote = `[REFUND] Amount: ₱${amount.toFixed(2)}. ${refundModalRemarks || ''}`;
      const updatedNotes = order.notes ? `${order.notes}\n${refundNote}` : refundNote;
      await supabase
        .from('booking')
        .update({ notes: updatedNotes })
        .eq('booking_id', id);

      setIsRefundModalOpen(false);
      fetchOrder();
      toast.success('Refund recorded.');
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to record refund.');
    } finally {
      setIsRefundSubmitting(false);
    }
  };

  // --- DELETE ---
  const handleDelete = async () => {
    // Same warning as the booking delete: name the money, because "associated
    // payments will also be deleted" does not convey the size of what is
    // leaving the reports.
    const recordedMoney = sumVerifiedPositivePayments(payments);
    const paymentRowCount = (payments || []).length;
    const moneyWarning = paymentRowCount > 0
      ? `

This will also delete ${paymentRowCount} payment record${paymentRowCount === 1 ? '' : 's'} totalling ₱${recordedMoney.toLocaleString()}. That money will disappear from every report.`
      : '';

    const confirmed = await showConfirm({
      title: 'Delete Short Order?',
      message: `Are you sure you want to permanently delete this ${order.booking_status} order? This action cannot be undone. Its vehicle assignments will be released.${moneyWarning}`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: 'Deleting this order is permanent. Re-enter your password to continue.',
    });
    if (!passwordOk) return;

    try {
      const { error: paymentsError } = await supabase
        .from('payment')
        .delete()
        .eq('booking_id', id);
      if (paymentsError) throw paymentsError;

      await supabase.from('vehicle_assign').delete().eq('booking_id', id);

      const { error } = await supabase
        .from('booking')
        .delete()
        .eq('booking_id', id);
      if (error) throw error;
      toast.success('Short order deleted.');
      navigate('/app/orders');
    } catch (error) {
      console.error(error);
      // Children are deleted before the parent for the foreign keys, so a
      // failure at the last step leaves the order standing with its payments
      // already gone.
      toast.error(
        'Failed to delete this order, and some of its records may already have been removed. Check it on the Payments page before trying again.',
        { duration: 10000 }
      );
    }
  };

  // --- EDIT MODAL ---
  const openEditModal = () => {
    if (!order) return;
    if (isPaymentLedgerLocked(order.booking_status)) {
      toast.error(bookingEditLockedMessage(order.booking_status, { noun: 'order' }));
      return;
    }
    let selections = [];
    try {
      if (order.menu_selections) {
        if (typeof order.menu_selections === 'string') {
          selections = JSON.parse(order.menu_selections);
        } else if (Array.isArray(order.menu_selections)) {
          selections = order.menu_selections;
        }
      }
    } catch (e) { selections = []; }
    setEditFormData({
      customer_id: order.customer_id || '',
      event_datetime: order.event_datetime ? new Date(order.event_datetime).toISOString().slice(0, 16) : '',
      venue: order.venue || '',
      delivery_fee: order.delivery_fee?.toString() || '0',
      total_amount: order.total_amount?.toString() || '',
      notes: order.notes || '',
      menu_selections: selections,
    });
    setEditTempItem({ menu_item_id: '', quantity: 1 });
    setEditFieldErrors({});
    setIsEditModalOpen(true);
  };

  const handleEditInputChange = (e) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({ ...prev, [name]: value }));
    setEditFieldErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  // Pickup writes the exact marker and zeroes the fee; delivery clears the
  // marker rather than leaving it to be edited into something that no longer
  // matches. Typing the marker by hand is what this exists to avoid.
  const setEditServiceMethod = (mode) => {
    setEditFormData(prev => ({
      ...prev,
      venue: mode === 'pickup' ? PICKUP_VENUE_MARKER : (prev.venue === PICKUP_VENUE_MARKER ? '' : prev.venue),
      delivery_fee: mode === 'pickup' ? '0' : prev.delivery_fee,
    }));
    setEditFieldErrors(prev => ({ ...prev, venue: undefined }));
  };

  const handleEditTempItemChange = (e) => {
    const { name, value } = e.target;
    setEditTempItem(prev => ({ ...prev, [name]: name === 'quantity' ? parseInt(value) || 0 : value }));
  };

  const addEditMenuItem = () => {
    if (!editTempItem.menu_item_id) {
      toast.error('Please select a menu item.');
      return;
    }
    const qty = parseInt(editTempItem.quantity) || 0;
    if (qty < 1) {
      toast.error('Quantity must be at least 1.');
      return;
    }
    const existing = (editFormData.menu_selections || []).find(item => item.menu_item_id === editTempItem.menu_item_id);
    if (existing) {
      toast.error('This item is already added.');
      return;
    }
    setEditFormData(prev => ({
      ...prev,
      menu_selections: [...(prev.menu_selections || []), { menu_item_id: editTempItem.menu_item_id, quantity: qty }],
    }));
    setEditTempItem({ menu_item_id: '', quantity: 1 });
  };

  const updateEditMenuItemQuantity = (menuItemId, quantity) => {
    if (quantity < 1) return;
    setEditFormData(prev => ({
      ...prev,
      menu_selections: (prev.menu_selections || []).map(item =>
        item.menu_item_id === menuItemId ? { ...item, quantity: parseInt(quantity) } : item
      ),
    }));
  };

  const removeEditMenuItem = (menuItemId) => {
    setEditFormData(prev => ({
      ...prev,
      menu_selections: (prev.menu_selections || []).filter(item => item.menu_item_id !== menuItemId),
    }));
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setEditFieldErrors({});

    if (isPaymentLedgerLocked(order.booking_status)) {
      toast.error(bookingEditLockedMessage(order.booking_status, { noun: 'order' }));
      setIsSubmitting(false);
      return;
    }

    if (!editFormData.venue || editFormData.venue.trim() === '') {
      toast.error('Please enter the delivery address.');
      setEditFieldErrors({ venue: 'Please enter the delivery address.' });
      setIsSubmitting(false);
      return;
    }
    if (!editFormData.event_datetime) {
      toast.error('Please select an event date and time.');
      setEditFieldErrors({ event_datetime: 'Please select an event date and time.' });
      setIsSubmitting(false);
      return;
    }
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
      // Same hard block as the ShortOrders list page's Add/Edit form — this
      // Details-page edit form never had it, so editing an order's date
      // here could silently violate PG's 3-day notice policy.
      toast.error('Orders must be placed at least 3 days before the event date — this is PG\'s catering policy.');
      setEditFieldErrors({ event_datetime: 'Must be at least 3 days from today.' });
      setIsSubmitting(false);
      return;
    }
    if (!editFormData.menu_selections || editFormData.menu_selections.length === 0) {
      toast.error('Please add at least one menu item.');
      setEditFieldErrors({ menu_selections: 'Add at least one menu item.' });
      setIsSubmitting(false);
      return;
    }

    try {
      // Recalculate total from selections
      let total = 0;
      for (const sel of editFormData.menu_selections) {
        const menuItem = menuItems.find(m => m.menu_item_id === sel.menu_item_id);
        if (menuItem) {
          total += menuItem.menu_price * sel.quantity;
        }
      }
      total += parseFloat(editFormData.delivery_fee) || 0;

      const payload = {
        customer_id: editFormData.customer_id,
        event_datetime: editFormData.event_datetime ? new Date(editFormData.event_datetime).toISOString() : null,
        venue: editFormData.venue,
        notes: editFormData.notes || null,
        total_amount: total,
        delivery_fee: parseFloat(editFormData.delivery_fee) || 0,
        menu_selections: editFormData.menu_selections,
        booking_type: 'Short Order',
      };

      // Read before the write: reconciliation needs the direction of the
      // change, not just the new value.
      const previousVenue = order?.venue ?? null;

      const { error } = await supabase
        .from('booking')
        .update(payload)
        .eq('booking_id', id);
      if (error) throw error;
      setIsEditModalOpen(false);

      // Same hazard as the Short Orders list edit: an approved delivery
      // switched to a pickup would keep its van scheduled for a trip that
      // never happens.
      try {
        const sync = await reconcileServiceMethodChange({ ...payload, booking_id: id }, previousVenue);
        if (sync.cleared > 0) {
          toast(`Saved. ${sync.cleared} vehicle assignment${sync.cleared === 1 ? '' : 's'} released — the customer is collecting this order.`, { icon: 'ℹ️', duration: 7000 });
        } else if (sync.nowNeedsVehicle) {
          toast('Saved. This is now a delivery and has no vehicle — assign one from the Vehicles page.', { icon: '⚠️', duration: 8000 });
        } else {
          toast.success('Short order saved.');
        }
      } catch (syncError) {
        console.warn('Dispatch reconciliation failed:', syncError);
        toast('Order saved, but its vehicle assignments could not be updated: ' + syncError.message, { icon: '⚠️', duration: 8000 });
      }

      fetchOrder();
    } catch (error) {
      console.error(error);
      toast.error('Failed to update order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Vehicles are dispatched for a booking that is going ahead. Approval is
  // what allocates them, so assigning before that point would be duplicated by
  // the auto-allocation approval runs; and a Cancelled, Rejected or Completed
  // booking is not going anywhere.
  const canDispatch = ACTIVE_BOOKING_STATUSES.includes(order?.booking_status);

  // Service method drives the whole Dispatch section: a collection has no trip,
  // no vehicle and no button to assign one.
  const isCustomerPickup = getServiceMethod(order)?.mode === 'Pickup';

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

  if (loading) return <div className="p-12 text-center text-slate-500 font-medium">Loading...</div>;
  if (!order) return <div className="p-12 text-center text-slate-500">Short order not found.</div>;

  // --- Payment calculations ---
  // `positivePayments` stays a gross figure (money paid in, ignoring
  // refunds) — the refund-eligibility math below depends on that gross
  // number. `netPaid` is refunds netted out, used only where the UI shows
  // "how much does the customer actually have paid in right now" (the
  // Total Paid stat).
  const positivePayments = sumVerifiedPositivePayments(payments);
  const totalRefunded = payments
    .filter(p => p.amount_paid < 0)
    .reduce((sum, p) => sum + Math.abs(p.amount_paid), 0);
  const netPaid = Math.max(0, positivePayments - totalRefunded);

  // A refund is money going out, not a kind of payment — it doesn't belong
  // in the Payment Tracking ledger alongside actual payments. Split once
  // here so the Payment Tracking table only ever lists real payments, and
  // refunds get their own Refund History section instead.
  const paymentEntries = payments.filter(p => (p.amount_paid || 0) >= 0);
  const refundEntries = payments.filter(p => (p.amount_paid || 0) < 0);

  let remainingBalance = Math.max(0, (order.total_amount || 0) - positivePayments);
  if (order.booking_status === 'Rejected' || order.booking_status === 'Cancelled') remainingBalance = 0;

  const downpaymentPaid = sumVerifiedDownpayments(payments);

  const eventDate = order.event_datetime ? new Date(order.event_datetime) : null;
  const now = new Date();
  let daysUntilEvent = null;
  let isRefundable = false;
  if (eventDate) {
    const diffTime = eventDate.getTime() - now.getTime();
    daysUntilEvent = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    isRefundable = daysUntilEvent >= 3;
  }

  let remainingRefundableAmount = 0;
  if (order.booking_status === 'Rejected' || order.booking_status === 'Cancelled') {
    if (eventDate && daysUntilEvent !== null && daysUntilEvent < 3) {
      const refundableBase = Math.max(0, positivePayments - downpaymentPaid);
      remainingRefundableAmount = Math.max(0, refundableBase - totalRefunded);
    } else {
      remainingRefundableAmount = Math.max(0, positivePayments - totalRefunded);
    }
  }

  let refundStatus = null;
  if (positivePayments > 0 && (order.booking_status === 'Rejected' || order.booking_status === 'Cancelled')) {
    if (totalRefunded >= positivePayments) {
      refundStatus = 'Fully Refunded';
    } else if (isRefundable) {
      refundStatus = 'Refundable';
    } else {
      refundStatus = 'Non-Refundable';
    }
  }

  // Cancellation only opens up once the order is genuinely locked in
  // (Confirmed) — not while it's merely Approved-but-unpaid.
  const canCancel = order.booking_status === 'Confirmed';
  const showAddRefund = (order.booking_status === 'Rejected' || order.booking_status === 'Cancelled') && remainingRefundableAmount > 0;
  const canRecordPayment = ['Approved', 'Confirmed', 'Completed'].includes(order.booking_status);

  const totalTrays = menuSelections.reduce((sum, item) => sum + (item.quantity || 0), 0);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/app/orders')}
            className="w-10 h-10 bg-white border border-slate-300 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors shadow-xs"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {order.customer?.first_name} {order.customer?.last_name}
            </h1>
            <p className="text-xs text-slate-500">Order #: {order.booking_number || order.booking_id.slice(0, 8)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {order.booking_status === 'Pending' && (
            <>
              <button onClick={() => openApprovalModal(order, 'shortorder')} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm">
                <Check size={18} /> Approve
              </button>
              <button onClick={() => openRejectionModal(order.booking_id)} className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm">
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
              <Check size={18} /> {isConfirming ? 'Confirming...' : 'Confirm Order'}
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
              <X size={18} /> Cancel Order
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
            className={isPaymentLedgerLocked(order.booking_status) ? 'bg-white border border-slate-300 text-slate-400 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors' : 'bg-white border border-slate-300 text-slate-700 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors'}
            title={isPaymentLedgerLocked(order.booking_status) ? bookingEditLockedMessage(order.booking_status, { noun: 'order' }) : undefined}
          >
            {isPaymentLedgerLocked(order.booking_status) ? <Lock size={16} /> : <Edit size={16} />} Edit
          </button>
          <button
            onClick={handleDelete}
            className="bg-white border border-red-300 text-red-600 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-red-50 transition-colors"
            title="Permanently delete this order (password required)"
          >
            <Trash2 size={16} /> Delete
          </button>
          <button onClick={fetchOrder} className="bg-white border border-slate-300 text-slate-700 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Status Badge + Refund Indicator */}
      <div className="flex items-center gap-3">
        <span className={`px-4 py-1.5 rounded-full text-xs font-bold border ${
          order.booking_status === 'Pending' ? 'bg-amber-50 border-amber-200 text-amber-700' :
          order.booking_status === 'Approved' ? 'bg-[#EAF3F2] border-[#C1DEDC] text-slate-800' :
          order.booking_status === 'Confirmed' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
          order.booking_status === 'Completed' ? 'bg-blue-50 border-blue-200 text-blue-700' :
          order.booking_status === 'Cancelled' ? 'bg-slate-100 border-slate-300 text-slate-600' :
          'bg-red-50 border-red-200 text-red-700'
        }`}>
          {order.booking_status}
        </span>
        {hasUnpaidPastEvent({ booking_status: order.booking_status, event_datetime: order.event_datetime, total_amount: order.total_amount, positivePayments }) && (
          <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-red-50 border-red-200 text-red-700">
            Past Event — ₱{remainingBalance.toLocaleString()} Remaining
          </span>
        )}
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

        {/* ✅ NEW: Show balance remaining for completed orders */}
{order.booking_status === 'Completed' && positivePayments < (order.total_amount || 0) && (
  <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-amber-50 border-amber-200 text-amber-700">
    ⚠️ Balance Remaining
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

      {/* Day Availability — same shared layout as the Approve modal */}
      {order.booking_status === 'Pending' && order.event_datetime && (
        <ApprovalAvailabilityCheck
                onVehicleSelectionChange={setApprovalVehicleIds}
          booking={order}
          effectivePaxCount={0}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 border-l-4 border-l-[#008A45]/30 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Order Details</h3>
            <div className="space-y-2.5 text-sm">
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Created</span>
                <span className="col-span-2">
                  {order.book_datetime ? new Date(order.book_datetime).toLocaleString() : 'N/A'}
                </span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Event Date</span>
                <span className="col-span-2">
                  {order.event_datetime ? new Date(order.event_datetime).toLocaleString() : 'N/A'}
                </span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Venue / Location</span>
                <span className="col-span-2">{order.venue || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Total Trays</span>
                <span className="col-span-2 font-semibold">{totalTrays}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Service Method</span>
                <span className="col-span-2">
                  {(() => {
                    const f = getServiceMethod(order);
                    if (!f) return <span className="text-slate-500">N/A</span>;
                    return (
                      <>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12.5px] font-semibold ${
                          f.mode === 'Pickup' ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-700'
                        }`}>
                          {f.mode === 'Pickup' ? <PackageIcon size={13} /> : <Truck size={13} />}
                          {f.mode}
                        </span>
                        {/* The basis, always. Pickup and delivery are read from
                            the venue the customer app writes; the fee only ever
                            cross-checks the amount, never the mode. */}
                        <span className="block text-[12px] text-slate-500 mt-1">{f.basis}</span>
                        {f.feeLooksWrong && (
                          <span className="mt-1.5 flex items-start gap-1.5 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                            <span>{f.feeLooksWrong}</span>
                          </span>
                        )}
                      </>
                    );
                  })()}
                </span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Delivery Fee</span>
                <span className="col-span-2">₱{order.delivery_fee?.toLocaleString() || '0'}</span>
              </div>
              <div className="grid grid-cols-3 border-t border-slate-200 pt-2 mt-1">
                <span className="text-slate-700 font-bold">Total Amount</span>
                <span className="col-span-2 font-bold text-[#008A45]">₱{order.total_amount?.toLocaleString() || '0'}</span>
              </div>
            </div>
            {order.notes && (
              <div className="pt-4 mt-4 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-900 block mb-1">Notes</span>
                <p className="text-xs text-slate-500 whitespace-pre-wrap">{order.notes}</p>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 border-l-4 border-l-[#008A45]/30 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Customer Details</h3>
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Name</span>
                <span className="col-span-2">{order.customer?.first_name} {order.customer?.last_name}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Contact</span>
                <span className="col-span-2">{order.customer?.contact_no || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Email</span>
                <span className="col-span-2">{order.customer?.email_address || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Address</span>
                <span className="col-span-2">{order.customer?.cus_address || 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-7 space-y-6">
          {/* Dispatch — blueprint-03 5.8. Until now a vehicle appeared on this
              page only inside the delete warning, so the booking never knew
              what was carrying it while the vehicle knew its booking. */}
          <div className="bg-white border border-slate-200 border-l-4 border-l-[#008A45]/50 rounded-xl p-6 shadow-xs">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-900">Menu Items (Trays)</h3>
              <span className="text-xs font-medium text-slate-500">{menuSelections.length} item{menuSelections.length !== 1 ? 's' : ''}</span>
            </div>
            {menuSelections.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No menu items selected.</p>
            ) : (
              <div className="space-y-2">
                {menuSelections.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
                    <div>
                      <span className="text-sm font-semibold text-slate-700">{item.menu_name}</span>
                      <span className="text-xs text-slate-500 ml-2">× {item.quantity}</span>
                    </div>
                    <span className="text-sm font-bold text-slate-900">₱{(item.menu_price * item.quantity).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white border border-slate-200 border-l-4 border-l-[#008A45] rounded-xl p-6 shadow-xs">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-[#007038]">Payment Tracking</h3>
              {canRecordPayment && (
                <button
                  onClick={openPaymentModal}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <Plus size={14} /> Record Payment
                </button>
              )}
              {!canRecordPayment && order.booking_status === 'Pending' && (
                <span className="text-xs text-slate-400 italic">Approve this order to enable payments</span>
              )}
              {!canRecordPayment && (order.booking_status === 'Rejected' || order.booking_status === 'Cancelled') && (
                <span className="text-xs text-slate-400 italic">Payments closed</span>
              )}
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2 flex justify-between items-center text-sm">
              <span className="font-medium text-slate-700">Total Amount:</span>
              <span className="font-bold text-slate-900">₱{order.total_amount?.toLocaleString() || '0'}</span>
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
                {order.booking_status === 'Rejected' || order.booking_status === 'Cancelled'
                  ? `N/A — ${order.booking_status}`
                  : `₱${remainingBalance.toLocaleString()}`}
              </span>
            </div>
            {paymentEntries.length > 0 && (
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
                    {paymentEntries.map(p => {
                      const pendingVerification = p.pay_status === 'Pending Verification';
                      // Frozen historical label — matches Payments.jsx and
                      // BookingDetails.jsx: only the payment that actually
                      // clears the balance reads "Fully Paid".
                      const kind = describePaymentKind(
                        p,
                        payments.filter(other => other.payment_id !== p.payment_id
                          && new Date(other.pay_datetime || 0) <= new Date(p.pay_datetime || 0)),
                        order.total_amount,
                      );
                      return (
                      <tr key={p.payment_id} className={pendingVerification ? 'bg-blue-50' : ''}>
                        <td className="p-3 font-bold">
                          ₱{p.amount_paid.toLocaleString()}
                        </td>
                        <td className="p-3">{p.pay_method || 'N/A'}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            kind === 'Fully Paid' ? 'bg-green-100 text-green-700 border border-green-200' :
                            p.pay_status === 'Pending Verification' ? 'bg-blue-100 text-blue-700 border border-blue-200' :
                            p.pay_status === 'Proof Rejected' ? 'bg-red-100 text-red-700 border border-red-200' :
                            'bg-amber-100 text-amber-700 border border-amber-200'
                          }`}>
                            {kind}
                          </span>
                        </td>
                        <td className="p-3">{renderProof(p.pay_proof)}</td>
                        <td className="p-3">{p.pay_datetime ? new Date(p.pay_datetime).toLocaleString() : 'N/A'}</td>
                        <td className="p-3 text-center">
                          {pendingVerification && (
                            <div className="flex justify-center gap-2">
                              <button onClick={() => openVerifyModal(p)} disabled={isVerifying} className="text-green-600 hover:text-green-800 disabled:opacity-50" title="Verify Payment">
                                <Check size={14} />
                              </button>
                              <button onClick={() => openRejectProofModal(p)} disabled={isVerifying} className="text-red-500 hover:text-red-700 disabled:opacity-50" title="Reject Proof">
                                <X size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Refund History — a refund is money going out, not a kind of
              payment, so it gets its own place instead of sitting inside
              the Payment Tracking ledger above. Carries the refund-specific
              numbers (total refunded, what's still refundable) and the
              eligibility status that used to live inside Payment Tracking. */}
          {refundEntries.length > 0 && (
            <div className="bg-white border border-slate-200 border-l-4 border-l-red-500 rounded-xl p-6 shadow-xs">
              <h3 className="text-sm font-bold text-red-700 mb-4">Refund History</h3>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <span className="text-xs font-medium text-slate-700 block">Total Refunded</span>
                  <span className="font-bold text-red-700">-₱{totalRefunded.toLocaleString()}</span>
                </div>
                <div className={`rounded-lg p-3 border ${remainingRefundableAmount > 0 ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                  <span className="text-xs font-medium text-slate-700 block">Remaining Refundable</span>
                  <span className={`font-bold ${remainingRefundableAmount > 0 ? 'text-green-700' : 'text-slate-500'}`}>
                    ₱{remainingRefundableAmount.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="mb-4 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600">
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

              <div className="border border-slate-300 rounded-lg overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-red-50 text-slate-900 font-bold border-b border-slate-300">
                      <th className="p-3">Amount</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Reason</th>
                      <th className="p-3">Proof</th>
                      <th className="p-3">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-700">
                    {refundEntries.map(p => (
                      <tr key={p.payment_id} className="bg-red-50/40">
                        <td className="p-3 font-bold text-red-600">
                          -₱{Math.abs(p.amount_paid).toLocaleString()}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-200">
                            Refunded
                          </span>
                        </td>
                        <td className="p-3">{p.remarks || 'N/A'}</td>
                        <td className="p-3">{renderProof(p.pay_proof)}</td>
                        <td className="p-3">{p.pay_datetime ? new Date(p.pay_datetime).toLocaleString() : 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                    <tr>
                      <td className="p-3 font-bold text-red-700">-₱{totalRefunded.toLocaleString()}</td>
                      <td colSpan="4" className="p-3 text-right font-medium text-slate-600">Total refunded</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Menu Items List */}
          <div className="bg-white border border-slate-200 border-l-4 border-l-[#008A45]/50 rounded-xl p-6 shadow-xs">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                Dispatch
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 border border-sky-200">
                  Short Order
                </span>
              </h3>
              <div className="flex items-center gap-2">
                {/* Hidden on a pickup: there is nothing to dispatch, and the
                    button would walk a manager into assigning a van for an
                    order the customer is collecting. */}
                {!isCustomerPickup && canDispatch && (
                  <button
                    onClick={() => setIsAssignVehicleOpen(true)}
                    className="bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors shadow-sm"
                  >
                    <ClipboardList size={14} /> {dispatches.length === 0 ? 'Assign vehicle' : 'Manage'}
                  </button>
                )}
                <span className="text-xs font-medium text-slate-500">
                  {dispatches.length} vehicle{dispatches.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {dispatches.length === 0 ? (
              <p className="text-sm text-slate-500">
                {isCustomerPickup
                  ? 'No vehicle needed — the customer is collecting this order from the main branch.'
                  : canDispatch
                    ? 'No vehicle assigned yet. This delivery still needs transport arranged.'
                    : order?.booking_status === 'Pending'
                      ? 'Vehicles are assigned when this order is approved.'
                      : `No vehicles — this order is ${order?.booking_status?.toLowerCase() || 'not active'}.`}
              </p>
            ) : (
              <div className="space-y-2">
                {isCustomerPickup && (
                  <p className="flex items-start gap-1.5 text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span>This is a customer pickup, but a vehicle is still assigned to it. Release it from the Vehicles page unless it is being delivered after all.</span>
                  </p>
                )}
                {[...dispatches]
                  .sort((x, y) => new Date(x.dispatch_datetime || 0) - new Date(y.dispatch_datetime || 0))
                  .map(d => {
                  const returned = d.assignment_status === 'Completed';
                  const win = getDispatchWindow(d, order);
                  const isCollection = win?.leg === TRIP_LEG.pickup;
                  return (
                    <div key={d.assignment_id} className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">
                          {d.vehicle?.plate_number || 'Unknown vehicle'}
                          <span className="ml-2 text-[12.5px] font-medium text-slate-500">{d.vehicle?.vehicle_type || ''}</span>
                        </p>
                        <p className="text-[13px] text-slate-600 mt-0.5">
                          {win && !isCustomerPickup && (
                            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full mr-2 ${
                              isCollection ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
                            }`}>
                              {win.legLabel}
                            </span>
                          )}
                          {win
                            ? `${isCollection ? 'Collects from' : 'Leaves'} ${win.start.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · back ${win.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            : `Leaves ${d.dispatch_datetime ? new Date(d.dispatch_datetime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'time not set'}`}
                        </p>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12.5px] font-semibold whitespace-nowrap ${
                        returned ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {returned ? 'Returned' : 'Scheduled'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Payment Tracking */}
        </div>
      </div>

      {/* ===== EDIT MODAL ===== */}
      {isEditModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Edit Short Order</h2>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 overflow-y-auto space-y-5 text-left">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Customer *</label>
                <Select
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
                </Select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Event Date & Time *</label>
                <DateTimePicker
                  name="event_datetime"
                  value={editFormData.event_datetime}
                  onChange={handleEditInputChange}
                  hasError={!!editFieldErrors.event_datetime}
                  minLeadDays={3}
                  required
                />
                {editFieldErrors.event_datetime && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.event_datetime}</p>}
                <p className="text-[11px] text-slate-400 mt-1">Orders must be placed at least 3 days before the event — PG's catering policy.</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Service Method *</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'pickup', label: 'Pickup', icon: PackageIcon, hint: 'Collected at the main branch' },
                    { key: 'delivery', label: 'Delivery', icon: Truck, hint: 'Delivered to an address' },
                  ].map(opt => {
                    const active = (editFormData.venue === PICKUP_VENUE_MARKER) === (opt.key === 'pickup');
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setEditServiceMethod(opt.key)}
                        className={`flex flex-col items-start gap-0.5 border rounded-lg p-2.5 text-left transition-colors cursor-pointer ${
                          active
                            ? 'border-[#008A45] bg-[#EAF3F2] ring-1 ring-[#008A45]/20'
                            : 'border-slate-300 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <span className={`flex items-center gap-1.5 text-sm font-semibold ${active ? 'text-[#007038]' : 'text-slate-700'}`}>
                          <Icon size={14} /> {opt.label}
                        </span>
                        <span className="text-[11px] text-slate-500">{opt.hint}</span>
                      </button>
                    );
                  })}
                </div>
                {/* Switching to pickup here releases the vehicle on save, so
                    say so before the manager commits rather than after. */}
                {editFormData.venue === PICKUP_VENUE_MARKER && dispatches.some(d => d.assignment_status !== 'Completed') && (
                  <p className="flex items-start gap-1.5 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-1.5">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>Saving will release the vehicle currently assigned to this order.</span>
                  </p>
                )}
              </div>

              {editFormData.venue !== PICKUP_VENUE_MARKER && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Delivery address *</label>
                    <input
                      type="text"
                      name="venue"
                      value={editFormData.venue}
                      onChange={handleEditInputChange}
                      placeholder="e.g. Banga, Bayawan City"
                      className={errorInputClass(!!editFieldErrors.venue, 'w-full border rounded-lg p-2.5 text-sm outline-none')}
                      required
                    />
                    {editFieldErrors.venue && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.venue}</p>}
                    <p className="text-[11px] text-slate-500 mt-1">
                      PG&apos;s delivers free within Bayawan, Santa Catalina and Basay. A delivery fee applies outside those.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Delivery Fee</label>
                    <input
                      type="number"
                      name="delivery_fee"
                      min="0"
                      step="0.01"
                      value={editFormData.delivery_fee}
                      onChange={handleEditInputChange}
                      placeholder="0.00"
                      className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Menu Items (trays) *</label>
                {editFieldErrors.menu_selections && <p className="text-xs text-red-600 font-semibold mb-1">{editFieldErrors.menu_selections}</p>}
                <div className={`flex gap-2 mb-2 rounded-lg ${editFieldErrors.menu_selections ? 'ring-1 ring-red-300' : ''}`}>
                  <Select
                    name="menu_item_id"
                    value={editTempItem.menu_item_id}
                    onChange={handleEditTempItemChange}
                    className="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  >
                    <option value="">Choose item...</option>
                    {menuItems.map(item => (
                      <option key={item.menu_item_id} value={item.menu_item_id}>
                        {item.menu_name} (₱{item.menu_price} / tray)
                      </option>
                    ))}
                  </Select>
                  <input
                    type="number"
                    name="quantity"
                    min="1"
                    value={editTempItem.quantity}
                    onChange={handleEditTempItemChange}
                    className="w-20 border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    placeholder="#"
                  />
                  <button
                    type="button"
                    onClick={addEditMenuItem}
                    className="bg-[#008A45] hover:bg-[#007038] text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1"
                  >
                    <Plus size={16} /> Add
                  </button>
                </div>
                <div className="border border-slate-200 rounded-lg p-3 min-h-[80px] space-y-1.5 bg-slate-50">
                  {!editFormData.menu_selections || editFormData.menu_selections.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No items added yet.</p>
                  ) : (
                    editFormData.menu_selections.map((sel, idx) => {
                      const menuItem = menuItems.find(m => m.menu_item_id === sel.menu_item_id);
                      const subtotal = menuItem ? menuItem.menu_price * sel.quantity : 0;
                      return (
                        <div key={idx} className="flex items-center justify-between bg-white border border-slate-200 rounded px-3 py-1.5 text-sm">
                          <span className="font-medium text-slate-700">
                            {menuItem?.menu_name || 'Unknown'} × {sel.quantity}
                            <span className="text-xs text-slate-500 ml-2">₱{subtotal.toFixed(2)}</span>
                          </span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              value={sel.quantity}
                              onChange={(e) => updateEditMenuItemQuantity(sel.menu_item_id, e.target.value)}
                              className="w-14 border border-slate-300 rounded p-0.5 text-sm text-center"
                            />
                            <button
                              type="button"
                              onClick={() => removeEditMenuItem(sel.menu_item_id)}
                              className="text-red-500 hover:text-red-700 text-xs font-bold"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">Quantity = number of trays. Each tray serves 35‑50 pax.</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Total Amount (auto-calculated)</label>
                <input
                  type="number"
                  name="total_amount"
                  value={editFormData.total_amount}
                  onChange={handleEditInputChange}
                  placeholder="Auto-calculated"
                  step="0.01"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                  disabled
                />
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
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : 'Update Order'}
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
              <button onClick={() => setIsPaymentModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handlePaymentSubmit} className="p-6 overflow-y-auto space-y-6 text-left">
              <div className="bg-[#F8F9FA] border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
                <h4 className="font-bold text-slate-900 text-sm mb-2">Order Details</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <span className="text-slate-600 font-medium">Customer:</span>
                  <span className="text-slate-900 font-semibold">{order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Unknown'}</span>
                  <span className="text-slate-600 font-medium">Type:</span>
                  <span className="text-slate-900 font-semibold">Short Order</span>
                  <span className="text-slate-600 font-medium">Venue:</span>
                  <span className="text-slate-900 font-semibold">{order.venue || 'N/A'}</span>
                  <span className="text-slate-600 font-medium">Event Date:</span>
                  <span className="text-slate-900 font-semibold">{order.event_datetime ? new Date(order.event_datetime).toLocaleString() : 'N/A'}</span>
                  <span className="text-slate-600 font-medium">Total Amount:</span>
                  <span className="text-slate-900 font-bold text-[#008A45]">₱{order.total_amount?.toLocaleString() || '0'}</span>
                  <span className="text-slate-600 font-medium">Paid:</span>
                  <span className="text-slate-900 font-semibold">₱{positivePayments.toLocaleString()}</span>
                  <span className="text-slate-600 font-medium">Remaining:</span>
                  <span className={`font-semibold ${remainingBalance <= 0 ? 'text-green-700' : 'text-amber-700'}`}>₱{remainingBalance.toLocaleString()}</span>
                  <span className="text-slate-600 font-medium">Status:</span>
                  <span className="text-slate-900 font-semibold capitalize">{order.booking_status || 'N/A'}</span>
                  <span className="text-slate-600 font-medium">First Payment?</span>
                  <span className="text-slate-900 font-semibold">{positivePayments === 0 ? '✅ Yes' : 'No'}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Amount (₱)</label>
                  <input type="number" name="amount" value={paymentFormData.amount} onChange={handlePaymentInputChange} placeholder="0.00" step="0.01" required className={`w-full border rounded-lg p-2.5 text-sm focus:ring-2 outline-none ${paymentAmountError ? 'border-red-400 focus:ring-red-200 focus:border-red-400 bg-red-50/40' : 'border-slate-300 focus:ring-[#008A45]/20 focus:border-[#008A45]'}`} />
                  {paymentAmountError && (
                    <p className="text-xs text-red-600 mt-1 font-semibold">{paymentAmountError}</p>
                  )}
                  {!paymentAmountError && (() => {
                    const isFirst = positivePayments === 0;
                    const status = paymentFormData.pay_status;
                    const total = order.total_amount || 0;
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
                  <Select name="pay_status" value={paymentFormData.pay_status} onChange={handlePaymentInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white">
                    <option value="Downpayment">Downpayment</option>
                    <option value="Fully Paid">Fully Paid</option>
                  </Select>
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

      {/* ===== CANCEL ORDER MODAL ===== */}
      {isCancelModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Cancel Short Order</h2>
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
                  placeholder="e.g. Customer cancelled, rescheduled, budget issues"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                  required
                />
              </div>

          {isRefundable && (() => {
  const maxRefundable = positivePayments;
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
                  <p>⚠️ This order is <strong>non‑refundable</strong> because the event is less than 3 days away. The downpayment of ₱{downpaymentPaid.toLocaleString()} will be forfeited.</p>
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
                <textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows="3" placeholder="e.g., Incomplete details, client requested cancellation, etc." className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none" required />
                <p className="text-xs text-slate-400 mt-1">Reason is required.</p>
              </div>

              {showRejectionRefund && (
                <div className="border-t border-slate-200 pt-3 mt-3">
                  <p className="text-xs font-bold text-slate-700 mb-2">Process Refund <span className="font-normal text-slate-400">(optional – leave blank to skip)</span></p>
                  <p className="text-xs text-slate-500 mb-2">Max refundable: ₱{rejectionMaxRefundable.toLocaleString()}</p>
                  <p className="text-xs text-red-500 mb-2">* Proof of refund is required if you enter an amount.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-0.5">Refund Amount (₱)</label>
                      <input type="number" min="0" step="0.01" value={rejectionRefundAmount} onChange={(e) => setRejectionRefundAmount(e.target.value)} placeholder="Enter amount (optional)" className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-0.5">Remarks</label>
                      <input type="text" value={rejectionRefundRemarks} onChange={(e) => setRejectionRefundRemarks(e.target.value)} placeholder="Reason for refund" className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none" />
                    </div>
                  </div>
                  <div className="mt-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-0.5">Receipt / Proof of Refund <span className="text-red-500">*</span><span className="font-normal text-slate-400 ml-1">(required if amount entered)</span></label>
                    <label className="border-2 border-dashed border-slate-300 rounded-lg p-2 flex items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-center">
                      <input type="file" onChange={(e) => setRejectionRefundFile(e.target.files[0])} accept="image/*" className="hidden" />
                      <span className="text-xs text-slate-600">{rejectionRefundFile ? rejectionRefundFile.name : 'Upload Image (required for refund)'}</span>
                    </label>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setIsRejectionModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button onClick={handleRejectConfirm} className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm">Confirm Rejection</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== REFUND MODAL ===== */}
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
                <p><span className="font-medium">Order:</span> {order.booking_id.slice(0, 8)} – {order.customer?.first_name} {order.customer?.last_name}</p>
                <p className="text-xs text-slate-500 mt-1">Refundable amount: ₱{remainingRefundableAmount.toLocaleString()}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Refund Amount (₱)</label>
                <input type="number" min="0" step="0.01" value={refundModalAmount} onChange={(e) => setRefundModalAmount(e.target.value)} placeholder="e.g. 5000" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:border-[#008A45] outline-none" required />
                <p className="text-xs text-slate-400 mt-0.5">Max: ₱{remainingRefundableAmount.toLocaleString()}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Remarks</label>
                <input type="text" value={refundModalRemarks} onChange={(e) => setRefundModalRemarks(e.target.value)} placeholder="Reason for refund" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:border-[#008A45] outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Proof of Refund <span className="text-red-500">*</span></label>
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
      {isApprovalModalOpen && approvalOrder && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Approve Short Order – Adjust Fees</h2>
              <button onClick={() => setIsApprovalModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6 text-left">
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="font-medium text-slate-600">Customer:</span>
                  <span className="font-bold text-slate-900">{approvalOrder.customer?.first_name} {approvalOrder.customer?.last_name}</span>
                  <span className="font-medium text-slate-600">Venue:</span>
                  <span className="font-bold text-slate-900">{approvalOrder.venue || 'N/A'}</span>
                  <span className="font-medium text-slate-600">Current Total:</span>
                  <span className="font-bold text-slate-900">₱{approvalOrder.total_amount?.toLocaleString() || '0'}</span>
                </div>
                <p className="text-xs text-slate-500 mt-2">Short order pricing is per tray. You can add extra fees below.</p>
              </div>

              <ApprovalAvailabilityCheck
                onVehicleSelectionChange={setApprovalVehicleIds}
                booking={approvalOrder}
                effectivePaxCount={0}
              />

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Extra Quantity Fee (additional trays / items)</label>
                  <input type="number" name="extraQuantity" min="0" step="0.01" value={approvalData.extraQuantity} onChange={handleApprovalInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" placeholder="e.g. 1000" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Additional Delivery Fee</label>
                  <input type="number" name="extraDeliveryFee" min="0" step="0.01" value={approvalData.extraDeliveryFee} onChange={handleApprovalInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" placeholder="e.g. 500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Other Fees (add-ons)</label>
                  <input type="number" name="additionalFee" min="0" step="0.01" value={approvalData.additionalFee} onChange={handleApprovalInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" placeholder="e.g. 2000" />
                </div>
              </div>

              <div className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-lg p-4 flex justify-between items-center">
                <span className="font-bold text-slate-800">New Total:</span>
                <span className="text-xl font-extrabold text-[#008A45]">₱{approvalData.newTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              <div className="text-sm text-slate-500">
                <p>Downpayment (50%): <span className="font-bold">₱{(approvalData.newTotal * 0.5).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></p>
                <p className="text-xs mt-1">Downpayment may be required for large orders.</p>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={() => setIsApprovalModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button onClick={handleFinalizeApproval} disabled={isApprovalSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50">
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
                    <span className="text-slate-500">Order Total</span>
                    <span className="font-semibold text-slate-900">₱{(order?.total_amount || 0).toLocaleString()}</span>
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
      {/* In place, next to the page's other modals — assigning a vehicle is
          a decision about THIS booking, so it should not cost the manager
          their place on the page. */}
      {isAssignVehicleOpen && (
        <AssignVehicleModal
          booking={order}
          isOpen={isAssignVehicleOpen}
          onClose={() => setIsAssignVehicleOpen(false)}
          onAssigned={fetchOrder}
        />
      )}
    </div>
  );
}
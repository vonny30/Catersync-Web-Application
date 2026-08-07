// src/pages/ShortOrderDetails.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Edit, Trash2, Check, X, Plus, Image as ImageIcon } from 'lucide-react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';

export default function ShortOrderDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();

  const [order, setOrder] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [menuItemsDetails, setMenuItemsDetails] = useState([]);

  // --- Edit Modal State ---
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [editFormData, setEditFormData] = useState({
    customer_id: '',
    booking_type: 'Short Order',
    event_datetime: '',
    venue: '',
    notes: '',
    total_amount: '0',
    delivery_fee: '0',
    menu_selections: [],
  });
  const [tempItem, setTempItem] = useState({ menu_item_id: '', quantity: 1 });

  // --- Payment Modal State (Record) ---
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [paymentFormData, setPaymentFormData] = useState({
    amount: '',
    pay_method: 'Cash',
    pay_status: 'Downpayment',
    pay_proof: 'placeholder.png',
  });

  // --- Edit Payment Modal State ---
  const [isEditPaymentModalOpen, setIsEditPaymentModalOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState(null);
  const [editPaymentFormData, setEditPaymentFormData] = useState({
    amount: '',
    pay_method: 'Cash',
    pay_status: 'Downpayment',
    pay_proof: 'placeholder.png',
  });
  const [editSelectedFile, setEditSelectedFile] = useState(null);

  // --- Cancel Order Modal State ---
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundRemarks, setRefundRemarks] = useState('');
  const [refundFile, setRefundFile] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // --- Rejection Modal State ---
  const [isRejectionModalOpen, setIsRejectionModalOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionRefundAmount, setRejectionRefundAmount] = useState('');
  const [rejectionRefundRemarks, setRejectionRefundRemarks] = useState('');
  const [rejectionRefundFile, setRejectionRefundFile] = useState(null);
  const [showRejectionRefund, setShowRejectionRefund] = useState(false);
  const [rejectionMaxRefundable, setRejectionMaxRefundable] = useState(0);

  // --- Refund after rejection modal ---
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const [refundModalAmount, setRefundModalAmount] = useState('');
  const [refundModalRemarks, setRefundModalRemarks] = useState('');
  const [refundModalFile, setRefundModalFile] = useState(null);
  const [isRefundSubmitting, setIsRefundSubmitting] = useState(false);

  // --- Approval Modal State ---
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [approvalOrder, setApprovalOrder] = useState(null);
  const [approvalData, setApprovalData] = useState({
    extraQuantity: 0,
    additionalFee: 0,
    extraDeliveryFee: 0,
    newTotal: 0,
    baseTotal: 0,
  });

  // --- HELPERS ---
  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

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

  // --- FETCH ORDER ---
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
        .single();
      if (orderError) throw orderError;
      setOrder(orderData);

      // Mark as read
      if (orderData && !orderData.is_read) {
        await supabase
          .from('booking')
          .update({ is_read: true })
          .eq('booking_id', id);
        setOrder(prev => ({ ...prev, is_read: true }));
      }

      // Payments (filter out placeholder Pending)
      try {
        const { data: paymentsData, error: paymentsError } = await supabase
          .from('payment')
          .select('*')
          .eq('booking_id', id)
          .order('pay_datetime', { ascending: false });
        if (paymentsError) throw paymentsError;
        const filtered = (paymentsData || []).filter(p => !(p.amount_paid === 0 && p.pay_status === 'Pending'));
        setPayments(filtered);
      } catch (e) {
        console.warn('Payments fetch error:', e);
        setPayments([]);
      }

      // Menu selections
      try {
        let selections = [];
        if (orderData.menu_selections) {
          if (typeof orderData.menu_selections === 'string') selections = JSON.parse(orderData.menu_selections);
          else if (Array.isArray(orderData.menu_selections)) selections = orderData.menu_selections;
          else if (typeof orderData.menu_selections === 'object') selections = Object.values(orderData.menu_selections);
        }
        if (selections.length > 0) {
          const menuItemIds = selections.map(s => s.menu_item_id).filter(Boolean);
          if (menuItemIds.length > 0) {
            const { data: menuData, error: menuError } = await supabase
              .from('menu_item')
              .select('menu_item_id, menu_name, menu_price')
              .in('menu_item_id', menuItemIds);
            if (menuError) throw menuError;
            const itemsWithDetails = selections.map(sel => {
              const menu = menuData.find(m => m.menu_item_id === sel.menu_item_id);
              return {
                menu_item_id: sel.menu_item_id,
                quantity: sel.quantity || 1,
                menu_name: menu?.menu_name || 'Unknown Item',
                menu_price: menu?.menu_price || 0,
              };
            });
            setMenuItemsDetails(itemsWithDetails);
          } else {
            setMenuItemsDetails([]);
          }
        } else {
          setMenuItemsDetails([]);
        }
      } catch (e) {
        console.warn('Menu selections fetch error:', e);
        setMenuItemsDetails([]);
      }
    } catch (error) {
      handleError(error, 'Unable to load order details. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrder();
    // fetch dropdown data for edit modal
    const fetchDropdownData = async () => {
      try {
        const { data: cust, error: custError } = await supabase
          .from('customer')
          .select('customer_id, first_name, last_name')
          .eq('account_status', 'Active')
          .order('first_name');
        if (custError) throw custError;
        setCustomers(cust || []);

        const { data: menu, error: menuError } = await supabase
          .from('menu_item')
          .select('menu_item_id, menu_name, menu_price')
          .eq('menu_availability', 'Available')
          .order('menu_name');
        if (menuError) throw menuError;
        setMenuItems(menu || []);
      } catch (error) {
        console.error('Error fetching dropdown data:', error);
      }
    };
    fetchDropdownData();
  }, [id]);

  // --- Approval Modal Handlers ---
  const openApprovalModal = () => {
    if (!order) return;
    const baseTotal = order.total_amount || 0;
    setApprovalOrder(order);
    setApprovalData({
      extraQuantity: 0,
      additionalFee: 0,
      extraDeliveryFee: 0,
      newTotal: baseTotal,
      baseTotal: baseTotal,
    });
    setIsApprovalModalOpen(true);
  };

  const handleApprovalInputChange = (e) => {
    const { name, value } = e.target;
    const numValue = parseFloat(value) || 0;
    setApprovalData(prev => {
      const updated = { ...prev, [name]: numValue };
      const newTotal = updated.baseTotal + updated.extraQuantity + updated.additionalFee + updated.extraDeliveryFee;
      return { ...updated, newTotal };
    });
  };

  const handleFinalizeApproval = async () => {
    if (!approvalOrder) return;
    setIsSubmitting(true);
    try {
      // Check 50% payment – warning only
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payment')
        .select('amount_paid')
        .eq('booking_id', approvalOrder.booking_id);
      if (paymentsError) throw paymentsError;
      const totalPaid = paymentsData.reduce((sum, p) => sum + (p.amount_paid || 0), 0);
      const required = approvalData.newTotal * 0.5;
      if (totalPaid < required) {
        const proceed = await showConfirm({
          title: '⚠️ Insufficient Downpayment',
          message: `Total paid (₱${totalPaid.toFixed(2)}) is less than 50% of the total (₱${required.toFixed(2)}).\n\nApproving this order may leave an unpaid balance.\nDo you still want to approve?`,
          confirmLabel: 'Yes, Approve',
          cancelLabel: 'Cancel',
          confirmVariant: 'warning',
        });
        if (!proceed) {
          setIsSubmitting(false);
          return;
        }
      }

      // --- Conflict check for other approved events on the same day ---
      const eventDate = approvalOrder.event_datetime ? new Date(approvalOrder.event_datetime) : null;
      if (eventDate) {
        const now = new Date();
        const diffDays = Math.ceil((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) {
          const proceed = await showConfirm({
            title: '⚠️ Event Date is in the Past',
            message: `This event is ${Math.abs(diffDays)} days ago. Approving a past event may affect reports. Do you still want to approve?`,
            confirmLabel: 'Yes, Approve Anyway',
            cancelLabel: 'Cancel Approval',
            confirmVariant: 'warning',
          });
          if (!proceed) {
            setIsSubmitting(false);
            return;
          }
        }

        const startOfDay = new Date(eventDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(eventDate);
        endOfDay.setHours(23, 59, 59, 999);
        const startISO = startOfDay.toISOString();
        const endISO = endOfDay.toISOString();

        const { data: otherEvents, error: conflictError } = await supabase
          .from('booking')
          .select(`
            booking_id,
            booking_type,
            venue,
            event_datetime,
            customer:customer_id (first_name, last_name)
          `)
          .eq('booking_status', 'Approved')
          .neq('booking_id', approvalOrder.booking_id)
          .gte('event_datetime', startISO)
          .lte('event_datetime', endISO);

        if (conflictError) throw conflictError;

        if (otherEvents && otherEvents.length > 0) {
          const list = otherEvents.map(e => {
            const cust = e.customer ? `${e.customer.first_name} ${e.customer.last_name}` : 'Unknown';
            const time = e.event_datetime ? new Date(e.event_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const type = e.booking_type === 'Short Order' ? 'Short Order' : 'Package';
            return `• ${cust} (${type}) at ${e.venue || 'N/A'} – ${time}`;
          }).join('\n');

          const proceed = await showConfirm({
            title: '⚠️ Existing Events on This Date',
            message: `The following events are already approved on ${eventDate.toLocaleDateString()}:\n\n${list}\n\nDo you still want to approve this order?`,
            confirmLabel: 'Approve Anyway',
            cancelLabel: 'Cancel',
            confirmVariant: 'warning',
          });
          if (!proceed) return;
        }
      }

      const newTotal = approvalData.newTotal;
      const newDeliveryFee = parseFloat(approvalOrder.delivery_fee || 0) + approvalData.extraDeliveryFee;

      // Update order status
      const { error: updateError } = await supabase
        .from('booking')
        .update({
          booking_status: 'Approved',
          total_amount: newTotal,
          delivery_fee: newDeliveryFee,
          notes: approvalOrder.notes ? `${approvalOrder.notes}\n[APPROVAL] Adjusted total: ₱${newTotal}` : `[APPROVAL] Adjusted total: ₱${newTotal}`,
        })
        .eq('booking_id', approvalOrder.booking_id);
      if (updateError) throw updateError;

      // Update payments to Downpayment
      const { error: updatePaymentsError } = await supabase
        .from('payment')
        .update({ pay_status: 'Downpayment' })
        .eq('booking_id', approvalOrder.booking_id);
      if (updatePaymentsError) throw updatePaymentsError;

      setIsApprovalModalOpen(false);
      fetchOrder();
      toast.success('Order approved and payments set to Downpayment.');
    } catch (error) {
      handleError(error, 'Failed to approve order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- REJECTION (with maxRefundable) ---
  const openRejectionModal = async () => {
    const positivePayments = payments
      .filter(p => p.amount_paid > 0)
      .reduce((sum, p) => sum + p.amount_paid, 0);
    const downpaymentPayments = payments.filter(p => p.pay_status === 'Downpayment' && p.amount_paid > 0);
    const totalDownpayment = downpaymentPayments.reduce((sum, p) => sum + p.amount_paid, 0);

    let warningMessage = 'Are you sure you want to reject this order? This will cancel it and cannot be undone.';
    if (positivePayments > 0) {
      const totalAmount = order.total_amount || 0;
      const percentage = totalAmount > 0 ? (positivePayments / totalAmount) * 100 : 0;
      warningMessage = `This order has payments totaling ₱${positivePayments.toLocaleString()} (${percentage.toFixed(1)}% of total). Rejecting will keep the payments recorded. You may need to process refunds separately. Do you still want to reject?`;
    }
    const confirmed = await showConfirm({
      title: 'Reject Order?',
      message: warningMessage,
      confirmLabel: 'Yes, Continue',
      cancelLabel: 'Cancel',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const eventDate = order.event_datetime ? new Date(order.event_datetime) : null;
    let isRefundable = false;
    if (eventDate) {
      const now = new Date();
      const diffTime = eventDate.getTime() - now.getTime();
      const daysUntilEvent = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      isRefundable = daysUntilEvent >= 3;
    }

    // Max refundable = all paid if >=3 days, otherwise only the excess above downpayment
    let maxRefundable = 0;
    if (isRefundable) {
      maxRefundable = positivePayments;
    } else {
      maxRefundable = Math.max(0, positivePayments - totalDownpayment);
    }

    setRejectionMaxRefundable(maxRefundable);
    setShowRejectionRefund(maxRefundable > 0);
    setRejectionReason('');
    setRejectionRefundAmount('');
    setRejectionRefundRemarks('');
    setRejectionRefundFile(null);
    setIsRejectionModalOpen(true);
  };

  const handleRejectConfirm = async () => {
    setIsRejectionModalOpen(false);
    try {
      const reasonText = rejectionReason.trim() || 'No reason provided';
      let updatedNotes = order.notes
        ? `${order.notes}\n[REJECTION] ${reasonText}`
        : `[REJECTION] ${reasonText}`;

      const { error } = await supabase
        .from('booking')
        .update({
          booking_status: 'Rejected',
          notes: updatedNotes,
        })
        .eq('booking_id', id);
      if (error) throw error;

      // Process refund if requested
      if (showRejectionRefund) {
        const enteredAmount = parseFloat(rejectionRefundAmount) || 0;
        if (enteredAmount > 0) {
          if (enteredAmount > rejectionMaxRefundable) {
            toast.error(`Refund amount cannot exceed ₱${rejectionMaxRefundable.toLocaleString()}.`);
            setIsRejectionModalOpen(true);
            return;
          }
          if (!rejectionRefundFile) {
            toast.error('Please upload a proof of refund receipt.');
            setIsRejectionModalOpen(true);
            return;
          }
          let proofUrl = 'refund_placeholder.png';
          const fileExt = rejectionRefundFile.name.split('.').pop();
          const fileName = `refunds/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
          const { error: uploadError } = await supabase.storage
            .from('images')
            .upload(fileName, rejectionRefundFile);
          if (!uploadError) {
            const { data: publicUrlData } = supabase.storage
              .from('images')
              .getPublicUrl(fileName);
            proofUrl = publicUrlData.publicUrl;
          } else {
            toast.error('Failed to upload refund proof. Please try again.');
            setIsRejectionModalOpen(true);
            return;
          }

          const { error: refundError } = await supabase
            .from('payment')
            .insert([{
              booking_id: id,
              amount_paid: -enteredAmount,
              pay_method: 'Refund',
              pay_status: 'Refunded',
              pay_datetime: new Date().toISOString(),
              pay_proof: proofUrl,
              customer_id: order.customer_id,
              remarks: rejectionRefundRemarks || 'Refund processed during rejection',
            }]);
          if (refundError) throw refundError;

          const refundNote = `[REFUND] Amount: ₱${enteredAmount.toFixed(2)}. ${rejectionRefundRemarks || ''}`;
          updatedNotes = updatedNotes + `\n${refundNote}`;
          await supabase
            .from('booking')
            .update({ notes: updatedNotes })
            .eq('booking_id', id);
        }
      }

      toast.success('Order rejected.');
      fetchOrder();
    } catch (error) {
      handleError(error, 'Failed to reject order.');
    }
  };

  // --- CANCEL (client-initiated) ---
  const openCancelModal = () => {
    setCancelReason('');
    setRefundAmount('');
    setRefundRemarks('');
    setRefundFile(null);
    setIsCancelModalOpen(true);
  };

  const handleCancelBooking = async () => {
    if (!cancelReason.trim()) {
      toast.error('Please provide a cancellation reason.');
      return;
    }
    setIsCancelling(true);
    try {
      const eventDate = order.event_datetime ? new Date(order.event_datetime) : null;
      const now = new Date();
      let isRefundable = false;
      let daysUntilEvent = 999;

      const positivePayments = payments
        .filter(p => p.amount_paid > 0)
        .reduce((sum, p) => sum + p.amount_paid, 0);
      const downpaymentPayments = payments.filter(p => p.pay_status === 'Downpayment' && p.amount_paid > 0);
      const totalDownpayment = downpaymentPayments.reduce((sum, p) => sum + p.amount_paid, 0);

      if (eventDate) {
        const diffTime = eventDate.getTime() - now.getTime();
        daysUntilEvent = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        isRefundable = daysUntilEvent >= 3;
      }

      let maxRefundable = 0;
      if (isRefundable) {
        maxRefundable = positivePayments;
      } else {
        maxRefundable = Math.max(0, positivePayments - totalDownpayment);
      }

      let refundNote = '';
      let shouldRefund = false;
      let refundAmountValue = 0;
      let proofUrl = 'refund_placeholder.png';

      const enteredAmount = parseFloat(refundAmount) || 0;
      if (enteredAmount > 0 && maxRefundable > 0) {
        refundAmountValue = Math.min(enteredAmount, maxRefundable);
        if (!refundFile) {
          toast.error('Please upload a proof of refund receipt.');
          setIsCancelling(false);
          return;
        }
        shouldRefund = true;
        // Upload proof
        const fileExt = refundFile.name.split('.').pop();
        const fileName = `refunds/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('images')
          .upload(fileName, refundFile);
        if (!uploadError) {
          const { data: publicUrlData } = supabase.storage
            .from('images')
            .getPublicUrl(fileName);
          proofUrl = publicUrlData.publicUrl;
        } else {
          toast.error('Failed to upload refund proof.');
          setIsCancelling(false);
          return;
        }

        if (isRefundable) {
          refundNote = `Refund of ₱${refundAmountValue.toFixed(2)} processed. ${refundRemarks || ''}`;
        } else {
          refundNote = `Refund of excess (₱${refundAmountValue.toFixed(2)}) processed. Downpayment of ₱${totalDownpayment.toFixed(2)} forfeited (less than 3 days). ${refundRemarks || ''}`;
        }
      } else {
        if (positivePayments > 0 && !isRefundable) {
          refundNote = `Client cancelled within ${daysUntilEvent} days (< 3 days). Downpayment of ₱${totalDownpayment.toLocaleString()} is non-refundable per policy.`;
        } else {
          refundNote = 'Client cancelled – no refund processed.';
        }
      }

      let updatedNotes = `[CANCELLATION] ${cancelReason}. ${refundNote}`;
      if (order.notes) {
        updatedNotes = `${order.notes}\n\n${updatedNotes}`;
      }

      const { error: updateError } = await supabase
        .from('booking')
        .update({
          booking_status: 'Rejected',
          notes: updatedNotes,
        })
        .eq('booking_id', id);
      if (updateError) throw updateError;

      if (shouldRefund && refundAmountValue > 0) {
        const { error: refundError } = await supabase
          .from('payment')
          .insert([{
            booking_id: id,
            amount_paid: -refundAmountValue,
            pay_method: 'Refund',
            pay_status: 'Refunded',
            pay_datetime: new Date().toISOString(),
            pay_proof: proofUrl,
            customer_id: order.customer_id,
            remarks: refundRemarks || 'Refund processed',
          }]);
        if (refundError) throw refundError;
      }

      setIsCancelModalOpen(false);
      fetchOrder();
      toast.success(`Order cancelled successfully. ${refundNote}`);
    } catch (error) {
      handleError(error, 'Failed to cancel order.');
    } finally {
      setIsCancelling(false);
    }
  };

  // --- DELETE ---
  const handleDelete = async () => {
    const confirmed = await showConfirm({
      title: 'Delete Order?',
      message: 'Are you sure you want to permanently delete this order? This action cannot be undone. All associated payments will also be deleted.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    try {
      const { error: paymentsError } = await supabase
        .from('payment')
        .delete()
        .eq('booking_id', id);
      if (paymentsError) throw paymentsError;
      const { error } = await supabase
        .from('booking')
        .delete()
        .eq('booking_id', id);
      if (error) throw error;
      toast.success('Order deleted.');
      navigate('/app/orders');
    } catch (error) {
      handleError(error, 'Failed to delete order.');
    }
  };

  // --- EDIT MODAL ---
  const openEditModal = () => {
    if (!order) return;
    let selections = [];
    try {
      if (order.menu_selections) {
        if (typeof order.menu_selections === 'string') selections = JSON.parse(order.menu_selections);
        else if (Array.isArray(order.menu_selections)) selections = order.menu_selections;
        else if (typeof order.menu_selections === 'object') selections = Object.values(order.menu_selections);
      }
    } catch (e) { selections = []; }
    setEditFormData({
      customer_id: order.customer_id || '',
      booking_type: 'Short Order',
      event_datetime: order.event_datetime ? new Date(order.event_datetime).toISOString().slice(0, 16) : '',
      venue: order.venue || '',
      notes: order.notes || '',
      total_amount: order.total_amount?.toString() || '0',
      delivery_fee: order.delivery_fee?.toString() || '0',
      menu_selections: selections,
    });
    setTempItem({ menu_item_id: '', quantity: 1 });
    setIsEditModalOpen(true);
  };

  const handleEditInputChange = (e) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleTempItemChange = (e) => {
    const { name, value } = e.target;
    setTempItem(prev => ({ ...prev, [name]: name === 'quantity' ? parseInt(value) || 0 : value }));
  };

  const addItemToSelection = () => {
    if (!tempItem.menu_item_id) {
      toast.error('Select a menu item.');
      return;
    }
    const qty = parseInt(tempItem.quantity) || 0;
    if (qty < 1) {
      toast.error('Quantity must be at least 1.');
      return;
    }
    const existing = editFormData.menu_selections.find(item => item.menu_item_id === tempItem.menu_item_id);
    if (existing) {
      toast.error('Item already added.');
      return;
    }
    setEditFormData(prev => ({
      ...prev,
      menu_selections: [...prev.menu_selections, { menu_item_id: tempItem.menu_item_id, quantity: qty }],
    }));
    setTempItem({ menu_item_id: '', quantity: 1 });
  };

  const removeItemFromSelection = (menu_item_id) => {
    setEditFormData(prev => ({
      ...prev,
      menu_selections: prev.menu_selections.filter(item => item.menu_item_id !== menu_item_id),
    }));
  };

  const updateItemQuantity = (menu_item_id, quantity) => {
    if (quantity < 1) return;
    setEditFormData(prev => ({
      ...prev,
      menu_selections: prev.menu_selections.map(item =>
        item.menu_item_id === menu_item_id ? { ...item, quantity: parseInt(quantity) } : item
      ),
    }));
  };

  // auto-calculate total for edit modal
  useEffect(() => {
    const total = editFormData.menu_selections.reduce((sum, sel) => {
      const menuItem = menuItems.find(m => m.menu_item_id === sel.menu_item_id);
      return sum + (menuItem ? menuItem.menu_price * sel.quantity : 0);
    }, 0) + parseFloat(editFormData.delivery_fee || 0);
    setEditFormData(prev => ({ ...prev, total_amount: total.toFixed(2) }));
  }, [editFormData.menu_selections, editFormData.delivery_fee, menuItems]);

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload = {
        customer_id: editFormData.customer_id,
        booking_type: 'Short Order',
        event_datetime: editFormData.event_datetime ? new Date(editFormData.event_datetime).toISOString() : null,
        venue: editFormData.venue || null,
        pax_count: 0,
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
      setIsEditModalOpen(false);
      toast.success('Order updated successfully!');
      fetchOrder();
    } catch (error) {
      handleError(error, 'Failed to update order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- PAYMENT HANDLERS (Record) ---
  const openPaymentModal = () => {
    setPaymentFormData({
      amount: '',
      pay_method: 'Cash',
      pay_status: 'Downpayment',
      pay_proof: 'placeholder.png',
    });
    setSelectedFile(null);
    setIsPaymentModalOpen(true);
  };

  const handlePaymentInputChange = (e) => {
    const { name, value } = e.target;
    setPaymentFormData(prev => ({ ...prev, [name]: value }));
  };

  const handlePaymentFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    setIsPaymentSubmitting(true);

    const amount = parseFloat(paymentFormData.amount) || 0;
    if (amount <= 0) {
      toast.error('Amount must be greater than zero.');
      setIsPaymentSubmitting(false);
      return;
    }
    if (!paymentFormData.pay_method) {
      toast.error('Please select a payment method.');
      setIsPaymentSubmitting(false);
      return;
    }
    if (!paymentFormData.pay_status) {
      toast.error('Please select a payment status.');
      setIsPaymentSubmitting(false);
      return;
    }

    const positivePayments = payments
      .filter(p => p.amount_paid > 0)
      .reduce((sum, p) => sum + p.amount_paid, 0);
    const totalAmount = order.total_amount || 0;
    const remainingBalance = Math.max(0, totalAmount - positivePayments);

    if (remainingBalance <= 0) {
      toast.error('This order is already fully paid. No additional payments are allowed.');
      setIsPaymentSubmitting(false);
      return;
    }
    if (amount > remainingBalance) {
      toast.error(`Amount exceeds remaining balance of ₱${remainingBalance.toLocaleString()}.`);
      setIsPaymentSubmitting(false);
      return;
    }
    if (!selectedFile && (paymentFormData.pay_proof === 'placeholder.png' || !paymentFormData.pay_proof)) {
      toast.error('Please upload a proof of payment image.');
      setIsPaymentSubmitting(false);
      return;
    }

    let finalPayStatus = paymentFormData.pay_status;
    const status = order.booking_status || 'Pending';

    if (status === 'Pending') {
      const hasDownpayment = payments.some(p => p.pay_status === 'Downpayment' && p.amount_paid > 0);
      if (hasDownpayment) {
        toast.error('This order already has a downpayment. Wait for approval before recording more payments.');
        setIsPaymentSubmitting(false);
        return;
      }
      if (paymentFormData.pay_status !== 'Downpayment') {
        toast.error('Pending orders can only receive downpayments. Please approve the order first.');
        setIsPaymentSubmitting(false);
        return;
      }
    }

    if (status === 'Approved' || status === 'Completed') {
      if (paymentFormData.pay_status === 'Fully Paid' && amount < remainingBalance) {
        toast.error(`To mark as fully paid, the amount must equal the remaining balance of ₱${remainingBalance.toLocaleString()}.`);
        setIsPaymentSubmitting(false);
        return;
      }
      const isAmountEqualRemaining = Math.abs(amount - remainingBalance) < 0.01;
      if (paymentFormData.pay_status === 'Downpayment' && isAmountEqualRemaining) {
        const confirm = await showConfirm({
          title: 'Full Payment?',
          message: `This payment amount (₱${amount.toLocaleString()}) equals the remaining balance. Would you like to mark it as Fully Paid instead?`,
          confirmLabel: 'Yes, Mark Fully Paid',
          cancelLabel: 'No, Keep as Downpayment',
          confirmVariant: 'success',
        });
        if (confirm) {
          finalPayStatus = 'Fully Paid';
          setPaymentFormData(prev => ({ ...prev, pay_status: 'Fully Paid' }));
        }
      }
    }

    try {
      let proofUrl = 'placeholder.png';
      if (selectedFile) {
        setUploading(true);
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
        setUploading(false);
      }

      const payload = {
        booking_id: id,
        amount_paid: amount,
        pay_method: paymentFormData.pay_method,
        pay_status: finalPayStatus,
        pay_datetime: new Date().toISOString(),
        pay_proof: proofUrl,
        customer_id: order.customer_id || null,
      };

      const { error } = await supabase.from('payment').insert([payload]);
      if (error) throw error;

      setIsPaymentModalOpen(false);
      fetchOrder();

      const statusMessage = finalPayStatus === 'Fully Paid'
        ? 'Payment recorded successfully and marked as Fully Paid!'
        : 'Payment recorded successfully!';
      toast.success(statusMessage);
    } catch (error) {
      handleError(error, 'Failed to record payment.');
    } finally {
      setIsPaymentSubmitting(false);
      setUploading(false);
    }
  };

  // --- EDIT PAYMENT ---
  const openEditPaymentModal = (payment) => {
    setEditingPayment(payment);
    setEditPaymentFormData({
      amount: payment.amount_paid?.toString() || '',
      pay_method: payment.pay_method || 'Cash',
      pay_status: payment.pay_status || 'Downpayment',
      pay_proof: payment.pay_proof || 'placeholder.png',
    });
    setEditSelectedFile(null);
    setIsEditPaymentModalOpen(true);
  };

  const handleEditPaymentSubmit = async (e) => {
    e.preventDefault();
    setIsPaymentSubmitting(true);
    const amount = parseFloat(editPaymentFormData.amount) || 0;
    if (amount <= 0) {
      toast.error('Amount must be greater than zero.');
      setIsPaymentSubmitting(false);
      return;
    }
    if (!editPaymentFormData.pay_method) {
      toast.error('Please select a payment method.');
      setIsPaymentSubmitting(false);
      return;
    }
    if (!editPaymentFormData.pay_status) {
      toast.error('Please select a payment status.');
      setIsPaymentSubmitting(false);
      return;
    }
    if (!editSelectedFile && (editPaymentFormData.pay_proof === 'placeholder.png' || !editPaymentFormData.pay_proof)) {
      toast.error('Please upload a proof of payment image.');
      setIsPaymentSubmitting(false);
      return;
    }

    try {
      let proofUrl = editPaymentFormData.pay_proof;
      if (editSelectedFile) {
        setUploading(true);
        const fileExt = editSelectedFile.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `payments/${fileName}`;
        const { error: uploadError } = await supabase.storage
          .from('images')
          .upload(filePath, editSelectedFile);
        if (uploadError) throw uploadError;
        const { data: publicUrlData } = supabase.storage
          .from('images')
          .getPublicUrl(filePath);
        proofUrl = publicUrlData.publicUrl;
        setUploading(false);
      }

      const { error } = await supabase
        .from('payment')
        .update({
          amount_paid: amount,
          pay_method: editPaymentFormData.pay_method,
          pay_status: editPaymentFormData.pay_status,
          pay_proof: proofUrl,
        })
        .eq('payment_id', editingPayment.payment_id);
      if (error) throw error;
      setIsEditPaymentModalOpen(false);
      fetchOrder();
      toast.success('Payment updated successfully.');
    } catch (error) {
      handleError(error, 'Failed to update payment.');
    } finally {
      setIsPaymentSubmitting(false);
      setUploading(false);
    }
  };

  const handleDeletePayment = async (paymentId) => {
    const confirmed = await showConfirm({
      title: 'Delete Payment?',
      message: 'This will permanently delete this payment record. This action cannot be undone.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    try {
      const { error } = await supabase
        .from('payment')
        .delete()
        .eq('payment_id', paymentId);
      if (error) throw error;
      toast.success('Payment deleted.');
      fetchOrder();
    } catch (error) {
      handleError(error, 'Failed to delete payment.');
    }
  };

  // --- REFUND AFTER REJECTION ---
  const openRefundModal = () => {
    const positivePayments = payments
      .filter(p => p.amount_paid > 0)
      .reduce((sum, p) => sum + p.amount_paid, 0);
    const totalRefunded = payments
      .filter(p => p.amount_paid < 0)
      .reduce((sum, p) => sum + Math.abs(p.amount_paid), 0);
    const remainingRefundable = Math.max(0, positivePayments - totalRefunded);
    setRefundModalAmount(remainingRefundable > 0 ? remainingRefundable.toFixed(2) : '');
    setRefundModalRemarks('');
    setRefundModalFile(null);
    setIsRefundModalOpen(true);
  };

  const handleRefundSubmit = async (e) => {
    e.preventDefault();
    const positivePayments = payments
      .filter(p => p.amount_paid > 0)
      .reduce((sum, p) => sum + p.amount_paid, 0);
    const totalRefunded = payments
      .filter(p => p.amount_paid < 0)
      .reduce((sum, p) => sum + Math.abs(p.amount_paid), 0);
    const remainingRefundable = Math.max(0, positivePayments - totalRefunded);

    const amount = parseFloat(refundModalAmount) || 0;
    if (amount <= 0) {
      toast.error('Please enter a valid refund amount.');
      return;
    }
    if (amount > remainingRefundable) {
      toast.error(`Amount exceeds remaining refundable (₱${remainingRefundable.toFixed(2)}).`);
      return;
    }
    if (!refundModalFile) {
      toast.error('Please upload a proof of refund receipt.');
      return;
    }

    setIsRefundSubmitting(true);
    try {
      let proofUrl = 'refund_placeholder.png';
      const fileExt = refundModalFile.name.split('.').pop();
      const fileName = `refunds/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('images')
        .upload(fileName, refundModalFile);
      if (uploadError) throw uploadError;
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
          remarks: refundModalRemarks || 'Refund processed after rejection',
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
      toast.success('Refund recorded successfully.');
    } catch (error) {
      handleError(error, 'Failed to record refund.');
    } finally {
      setIsRefundSubmitting(false);
    }
  };

  // --- RENDER ---
  if (loading) return <div className="p-12 text-center text-slate-500 font-medium">Loading...</div>;
  if (!order) return <div className="p-12 text-center text-slate-500">Order not found.</div>;

  // --- PAYMENT CALCULATIONS ---
  const positivePayments = payments
    .filter(p => p.amount_paid > 0)
    .reduce((sum, p) => sum + p.amount_paid, 0);
  const totalRefunded = payments
    .filter(p => p.amount_paid < 0)
    .reduce((sum, p) => sum + Math.abs(p.amount_paid), 0);

  let remainingBalance = Math.max(0, (order.total_amount || 0) - positivePayments);
  if (order.booking_status === 'Rejected') remainingBalance = 0;

  const downpaymentPaid = payments
    .filter(p => p.pay_status === 'Downpayment' && p.amount_paid > 0)
    .reduce((sum, p) => sum + p.amount_paid, 0);

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
  if (order.booking_status === 'Rejected') {
    if (eventDate && daysUntilEvent !== null && daysUntilEvent < 3) {
      const refundableBase = Math.max(0, positivePayments - downpaymentPaid);
      remainingRefundableAmount = Math.max(0, refundableBase - totalRefunded);
    } else {
      remainingRefundableAmount = Math.max(0, positivePayments - totalRefunded);
    }
  }

  const canCancel = order.booking_status === 'Approved';
  const showAddRefund = order.booking_status === 'Rejected' && remainingRefundableAmount > 0;

  const isRejectedAndRefundable = order.booking_status === 'Rejected' && isRefundable && positivePayments > 0;
  const isRejectedAndNonRefundable = order.booking_status === 'Rejected' && !isRefundable && positivePayments > 0;

  const itemsSubtotal = menuItemsDetails.reduce((sum, i) => sum + i.menu_price * i.quantity, 0);
  const deliveryFee = order.delivery_fee || 0;
  const totalTrays = menuItemsDetails.reduce((sum, i) => sum + i.quantity, 0);

  // Render proof helper
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
        onClick={() => window.open(fullUrl, '_blank')}
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

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/app/orders')}
            className="w-10 h-10 bg-white border border-slate-300 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-50 shadow-xs"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {order.customer?.first_name} {order.customer?.last_name}
            </h1>
            <p className="text-xs text-slate-500">Order ID: {order.booking_id}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {order.booking_status === 'Pending' && (
            <>
              <button onClick={openApprovalModal} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm">
                <Check size={18} /> Approve
              </button>
              <button onClick={openRejectionModal} className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm">
                <X size={18} /> Reject
              </button>
            </>
          )}
          {canCancel && (
            <button onClick={openCancelModal} className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm">
              <X size={18} /> Cancel Order
            </button>
          )}
          {showAddRefund && (
            <button onClick={openRefundModal} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm">
              Add Refund
            </button>
          )}
          <button onClick={openEditModal} className="bg-white border border-slate-300 text-slate-700 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors">
            <Edit size={16} /> Edit
          </button>
          <button onClick={handleDelete} className="bg-white border border-red-300 text-red-600 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-red-50 transition-colors">
            <Trash2 size={16} /> Delete
          </button>
          <button onClick={fetchOrder} className="bg-white border border-slate-300 text-slate-700 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* STATUS BADGES */}
      <div className="flex items-center gap-3">
        <span className={`px-4 py-1.5 rounded-full text-xs font-bold border ${
          order.booking_status === 'Pending' ? 'bg-amber-50 border-amber-200 text-amber-700' :
          order.booking_status === 'Approved' ? 'bg-[#EAF3F2] border-[#C1DEDC] text-slate-800' :
          order.booking_status === 'Completed' ? 'bg-blue-50 border-blue-200 text-blue-700' :
          'bg-red-50 border-red-200 text-red-700'
        }`}>
          {order.booking_status}
        </span>
        {isRejectedAndRefundable && (
          <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-green-50 border-green-200 text-green-700">✅ Refundable</span>
        )}
        {isRejectedAndNonRefundable && (
          <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-red-50 border-red-200 text-red-700">❌ Non-Refundable</span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Order Details</h3>
            <div className="space-y-2.5 text-sm">
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Created</span>
                <span className="col-span-2">{order.book_datetime ? new Date(order.book_datetime).toLocaleString() : 'N/A'}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Event Date</span>
                <span className="col-span-2">{order.event_datetime ? new Date(order.event_datetime).toLocaleString() : 'N/A'}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Venue</span>
                <span className="col-span-2">{order.venue || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Total Trays</span>
                <span className="col-span-2">{totalTrays}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Order Type</span>
                <span className="col-span-2">Short Order</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Subtotal</span>
                <span className="col-span-2">₱{itemsSubtotal.toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-slate-700 font-bold">Delivery Fee</span>
                <span className="col-span-2">₱{deliveryFee.toLocaleString()}</span>
              </div>
              <div className="grid grid-cols-3 border-t border-slate-200 pt-2 mt-1">
                <span className="text-slate-700 font-bold">Total</span>
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

          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Client Details</h3>
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
          {/* Payment Tracking */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-900">Payment Tracking</h3>
              {order.booking_status !== 'Rejected' && (
                <button onClick={openPaymentModal} className="bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm">
                  <Plus size={14} /> Record Payment
                </button>
              )}
              {order.booking_status === 'Rejected' && <span className="text-xs text-slate-400 italic">Payments closed</span>}
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
              <span className="font-bold text-[#008A45]">₱{positivePayments.toLocaleString()}</span>
            </div>
            <div className={`rounded-lg p-3 flex justify-between items-center text-sm border ${
              remainingBalance <= 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
            }`}>
              <span className="font-medium text-slate-700">Remaining Balance:</span>
              <span className={`font-bold ${remainingBalance <= 0 ? 'text-green-700' : 'text-amber-700'}`}>₱{remainingBalance.toLocaleString()}</span>
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
                    {payments.map(p => (
                      <tr key={p.payment_id} className={p.amount_paid < 0 ? 'bg-red-50' : ''}>
                        <td className={`p-3 font-bold ${p.amount_paid < 0 ? 'text-red-600' : ''}`}>
                          {p.amount_paid < 0 ? '-' : ''}₱{Math.abs(p.amount_paid).toLocaleString()}
                        </td>
                        <td className="p-3">{p.pay_method || 'N/A'}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            p.pay_status === 'Refunded' ? 'bg-red-100 text-red-700 border border-red-200' :
                            p.pay_status === 'Fully Paid' ? 'bg-green-100 text-green-700 border border-green-200' :
                            'bg-amber-100 text-amber-700 border border-amber-200'
                          }`}>
                            {p.pay_status || 'N/A'}
                          </span>
                        </td>
                        <td className="p-3">{renderProof(p.pay_proof)}</td>
                        <td className="p-3">{p.pay_datetime ? new Date(p.pay_datetime).toLocaleString() : 'N/A'}</td>
                        <td className="p-3 text-center">
                          <div className="flex justify-center gap-2">
                            <button onClick={() => openEditPaymentModal(p)} className="text-blue-500 hover:text-blue-700" title="Edit Payment">
                              <Edit size={14} />
                            </button>
                            <button onClick={() => handleDeletePayment(p.payment_id)} className="text-red-500 hover:text-red-700" title="Delete Payment">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {order.booking_status === 'Rejected' && positivePayments > 0 && (
              <div className="mt-4 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600">
                <p>
                  <span className="font-bold">Refund Status:</span>{' '}
                  {remainingRefundableAmount > 0 ? (
                    <span className="text-green-600 font-medium">Partial refund available (₱{remainingRefundableAmount.toFixed(2)})</span>
                  ) : totalRefunded > 0 ? (
                    <span className="text-slate-600">Fully refunded</span>
                  ) : (
                    <span className="text-red-600 font-medium">Non-refundable per policy</span>
                  )}
                </p>
                {isRejectedAndNonRefundable && <p className="mt-1 text-red-500">Downpayment forfeited (event within 3 days)</p>}
              </div>
            )}
          </div>

          {/* Ordered Items */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-900">Ordered Items (trays)</h3>
              <span className="text-xs font-medium text-slate-500">{totalTrays} total tray(s)</span>
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
                        <span className="text-xs text-slate-500 ml-2">× {item.quantity} tray(s)</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-500 block">₱{item.menu_price.toFixed(2)} / tray</span>
                        <span className="text-sm font-bold text-slate-900">₱{subtotal.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })}
                <div className="flex justify-between pt-2 border-t border-slate-200 mt-1">
                  <span className="text-sm font-bold text-slate-900">Subtotal</span>
                  <span className="text-sm font-bold text-slate-900">₱{itemsSubtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Delivery Fee</span>
                  <span>₱{order.delivery_fee?.toLocaleString() || '0'}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200 font-bold text-slate-900">
                  <span>Total</span>
                  <span className="text-[#008A45]">₱{order.total_amount?.toLocaleString() || '0'}</span>
                </div>
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
              <h2 className="text-lg font-bold text-slate-900">Edit Short Order</h2>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 overflow-y-auto space-y-5 text-left">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Customer *</label>
                <select name="customer_id" value={editFormData.customer_id} onChange={handleEditInputChange} required className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]">
                  <option value="">Select Customer</option>
                  {customers.map(c => (
                    <option key={c.customer_id} value={c.customer_id}>{c.first_name} {c.last_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Event Date & Time</label>
                <input type="datetime-local" name="event_datetime" value={editFormData.event_datetime} onChange={handleEditInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Venue / Location</label>
                <input type="text" name="venue" value={editFormData.venue} onChange={handleEditInputChange} placeholder="e.g. Pick-up or Delivery address" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Delivery Fee</label>
                <input type="number" name="delivery_fee" value={editFormData.delivery_fee} onChange={handleEditInputChange} placeholder="0.00" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Menu Items (trays)</label>
                <div className="flex gap-2 mb-2">
                  <select name="menu_item_id" value={tempItem.menu_item_id} onChange={handleTempItemChange} className="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none">
                    <option value="">Choose item...</option>
                    {menuItems.map(item => (
                      <option key={item.menu_item_id} value={item.menu_item_id}>
                        {item.menu_name} (₱{item.menu_price} / tray)
                      </option>
                    ))}
                  </select>
                  <input type="number" name="quantity" min="1" value={tempItem.quantity} onChange={handleTempItemChange} className="w-20 border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" placeholder="#" />
                  <button type="button" onClick={addItemToSelection} className="bg-[#008A45] hover:bg-[#007038] text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1">
                    <Plus size={16} /> Add
                  </button>
                </div>
                <div className="border border-slate-200 rounded-lg p-3 min-h-[80px] space-y-1.5 bg-slate-50">
                  {editFormData.menu_selections.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No items added yet.</p>
                  ) : (
                    editFormData.menu_selections.map((item, idx) => {
                      const menuItem = menuItems.find(m => m.menu_item_id === item.menu_item_id);
                      const subtotal = menuItem ? menuItem.menu_price * item.quantity : 0;
                      return (
                        <div key={idx} className="flex items-center justify-between bg-white border border-slate-200 rounded px-3 py-1.5 text-sm">
                          <span className="font-medium text-slate-700">
                            {menuItem?.menu_name || 'Unknown'} × {item.quantity}
                            <span className="text-xs text-slate-500 ml-2">₱{subtotal.toFixed(2)}</span>
                          </span>
                          <div className="flex items-center gap-2">
                            <input type="number" min="1" value={item.quantity} onChange={(e) => updateItemQuantity(item.menu_item_id, e.target.value)} className="w-14 border border-slate-300 rounded p-0.5 text-sm text-center" />
                            <button type="button" onClick={() => removeItemFromSelection(item.menu_item_id)} className="text-red-500 hover:text-red-700 text-xs font-bold">✕</button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">Quantity = number of trays. Each tray serves 35‑50 pax.</p>
              </div>

              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <label className="block text-xs font-bold text-slate-700 mb-1">Total Amount (editable)</label>
                <input type="number" name="total_amount" value={editFormData.total_amount} onChange={handleEditInputChange} placeholder="Auto-calculated" step="0.01" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" />
                <p className="text-xs text-slate-400 mt-1">Auto-calculated from menu items × quantity + delivery fee. You can adjust.</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notes (optional)</label>
                <textarea name="notes" value={editFormData.notes} onChange={handleEditInputChange} rows="2" placeholder="Special instructions..." className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45] resize-none" />
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
                  <span className="text-slate-900 font-semibold">
                    {order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Unknown'}
                  </span>
                  <span className="text-slate-600 font-medium">Type:</span>
                  <span className="text-slate-900 font-semibold">{order.booking_type || 'N/A'}</span>
                  <span className="text-slate-600 font-medium">Venue:</span>
                  <span className="text-slate-900 font-semibold">{order.venue || 'N/A'}</span>
                  <span className="text-slate-600 font-medium">Event Date:</span>
                  <span className="text-slate-900 font-semibold">
                    {order.event_datetime ? new Date(order.event_datetime).toLocaleString() : 'N/A'}
                  </span>
                  <span className="text-slate-600 font-medium">Total Amount:</span>
                  <span className="text-slate-900 font-bold text-[#008A45]">₱{order.total_amount?.toLocaleString() || '0'}</span>
                  <span className="text-slate-600 font-medium">Paid:</span>
                  <span className="text-slate-900 font-semibold">₱{positivePayments.toLocaleString()}</span>
                  <span className="text-slate-600 font-medium">Remaining:</span>
                  <span className={`font-semibold ${remainingBalance <= 0 ? 'text-green-700' : 'text-amber-700'}`}>₱{remainingBalance.toLocaleString()}</span>
                  <span className="text-slate-600 font-medium">Status:</span>
                  <span className="text-slate-900 font-semibold capitalize">{order.booking_status || 'N/A'}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Amount (₱)</label>
                  <input type="number" name="amount" value={paymentFormData.amount} onChange={handlePaymentInputChange} placeholder="0.00" step="0.01" required className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Payment Status</label>
                  <select name="pay_status" value={paymentFormData.pay_status} onChange={handlePaymentInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white">
                    <option value="Downpayment">Downpayment</option>
                    <option value="Fully Paid">Fully Paid</option>
                    <option value="Unpaid">Unpaid</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">Payment Method</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Cash', 'GCash', 'Bank Transfer'].map(method => (
                    <button key={method} type="button" onClick={() => setPaymentFormData(prev => ({ ...prev, pay_method: method }))} className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-sm font-semibold transition-all ${
                      paymentFormData.pay_method === method
                        ? 'bg-[#CBDEDD]/60 border-[#008A45] text-slate-900 shadow-xs'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}>
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
                <label className="border-2 border-dashed border-slate-300 rounded-lg p-4 flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-center relative overflow-hidden h-24">
                  <input type="file" onChange={handlePaymentFileChange} accept="image/*" className="hidden" />
                  <ImageIcon size={20} className="text-slate-400 mb-1" />
                  <span className="text-xs font-semibold text-slate-600">{selectedFile ? selectedFile.name : 'Upload Image'}</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">PNG, JPG up to 5MB</span>
                </label>
                <p className="text-xs text-slate-400 mt-1">Upload a proof image; will be stored in Supabase Storage.</p>
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
                  <span className="text-slate-900 font-semibold">{order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Unknown'}</span>
                  <span className="text-slate-600 font-medium">Type:</span>
                  <span className="text-slate-900 font-semibold">{order.booking_type || 'N/A'}</span>
                  <span className="text-slate-600 font-medium">Total Amount:</span>
                  <span className="text-slate-900 font-bold text-[#008A45]">₱{order.total_amount?.toLocaleString() || '0'}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Amount (₱)</label>
                  <input type="number" name="amount" value={editPaymentFormData.amount} onChange={(e) => setEditPaymentFormData({...editPaymentFormData, amount: e.target.value})} placeholder="0.00" step="0.01" required className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Payment Status</label>
                  <select name="pay_status" value={editPaymentFormData.pay_status} onChange={(e) => setEditPaymentFormData({...editPaymentFormData, pay_status: e.target.value})} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white">
                    <option value="Downpayment">Downpayment</option>
                    <option value="Fully Paid">Fully Paid</option>
                    <option value="Unpaid">Unpaid</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">Payment Method</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Cash', 'GCash', 'Bank Transfer'].map(method => (
                    <button key={method} type="button" onClick={() => setEditPaymentFormData(prev => ({ ...prev, pay_method: method }))} className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-sm font-semibold transition-all ${editPaymentFormData.pay_method === method ? 'bg-[#CBDEDD]/60 border-[#008A45] text-slate-900 shadow-xs' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
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
                <label className="border-2 border-dashed border-slate-300 rounded-lg p-4 flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-center relative overflow-hidden h-24">
                  <input type="file" onChange={(e) => setEditSelectedFile(e.target.files[0])} accept="image/*" className="hidden" />
                  <ImageIcon size={20} className="text-slate-400 mb-1" />
                  <span className="text-xs font-semibold text-slate-600">{editSelectedFile ? editSelectedFile.name : 'Upload New Image'}</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">PNG, JPG up to 5MB</span>
                </label>
                {editPaymentFormData.pay_proof !== 'placeholder.png' && !editSelectedFile && (
                  <p className="text-xs text-slate-400 mt-1">Current proof: <a href={getProofUrl(editPaymentFormData.pay_proof)} target="_blank" className="text-blue-500 underline">View</a></p>
                )}
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

      {/* ===== CANCEL ORDER MODAL ===== */}
      {isCancelModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Cancel Order</h2>
              <button onClick={() => setIsCancelModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className={`p-3 rounded-lg text-sm border ${eventDate && daysUntilEvent < 3 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                <p className="font-bold">Event Date: {eventDate ? new Date(eventDate).toLocaleString() : 'N/A'}</p>
                {eventDate && daysUntilEvent !== null && <p>{daysUntilEvent >= 0 ? `${daysUntilEvent} days until event` : 'Event has already passed'}</p>}
                {eventDate && daysUntilEvent !== null && daysUntilEvent < 3 && daysUntilEvent >= 0 && (
                  <p className="font-bold mt-1 text-red-600">⚠️ Cancellation is within 3 days – downpayment is NON-REFUNDABLE per policy.</p>
                )}
                {eventDate && daysUntilEvent !== null && daysUntilEvent >= 3 && (
                  <p className="font-bold mt-1 text-green-700">✅ Cancellation is 3+ days before event – downpayment IS refundable.</p>
                )}
                {positivePayments > 0 && <p className="mt-1">Total paid: <span className="font-bold">₱{positivePayments.toLocaleString()}</span></p>}
                {positivePayments > 0 && !isRefundable && <p className="mt-1 text-xs text-red-600">Downpayment (₱{downpaymentPaid.toLocaleString()}) will be forfeited.</p>}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Cancellation Reason *</label>
                <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows="3" placeholder="e.g., Client cancelled, rescheduled, budget issues, etc." className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none" required />
              </div>

              {(() => {
                const maxRefundable = isRefundable ? positivePayments : Math.max(0, positivePayments - downpaymentPaid);
                return maxRefundable > 0 && (
                  <div className="border-t border-slate-200 pt-3 mt-3">
                    <p className="text-xs font-bold text-slate-700 mb-2">Record Refund Details <span className="font-normal text-slate-400">(optional – leave blank to skip)</span></p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-0.5">Refund Amount (₱)</label>
                        <input type="number" min="0" step="0.01" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder="Enter amount (optional)" className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none" />
                        <p className="text-[10px] text-slate-400 mt-0.5">Max: ₱{maxRefundable.toLocaleString()}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-0.5">Remarks</label>
                        <input type="text" value={refundRemarks} onChange={(e) => setRefundRemarks(e.target.value)} placeholder="Reason for refund" className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none" />
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="block text-xs font-semibold text-slate-600 mb-0.5">Receipt / Proof of Refund <span className="text-red-500">*</span><span className="font-normal text-slate-400 ml-1">(required if amount entered)</span></label>
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
                <button type="button" onClick={() => setIsCancelModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button onClick={handleCancelBooking} disabled={isCancelling} className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50">
                  {isCancelling ? 'Processing...' : 'Confirm Cancellation'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== REJECTION REASON MODAL (with refund fields) ===== */}
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
                <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Rejection</label>
                <textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows="3" placeholder="e.g., Incomplete details, client requested cancellation, etc." className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none" />
                <p className="text-xs text-slate-400 mt-1">Optional, but recommended.</p>
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

      {/* ===== REFUND AFTER REJECTION MODAL ===== */}
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
                <p><span className="font-medium">Booking:</span> {order.booking_id.slice(0, 8)} – {order.customer?.first_name} {order.customer?.last_name}</p>
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
                    {approvalOrder.customer?.first_name} {approvalOrder.customer?.last_name}
                  </span>
                  <span className="font-medium text-slate-600">Venue:</span>
                  <span className="font-bold text-slate-900">{approvalOrder.venue || 'N/A'}</span>
                  <span className="font-medium text-slate-600">Current Total:</span>
                  <span className="font-bold text-slate-900">₱{approvalOrder.total_amount?.toLocaleString() || '0'}</span>
                </div>
                <p className="text-xs text-slate-500 mt-2">Short order pricing is per tray. You can add extra fees below.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Extra Quantity Fee (additional trays / items)</label>
                  <input
                    type="number"
                    name="extraQuantity"
                    min="0"
                    step="0.01"
                    value={approvalData.extraQuantity}
                    onChange={handleApprovalInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    placeholder="e.g. 1000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Additional Delivery Fee</label>
                  <input
                    type="number"
                    name="extraDeliveryFee"
                    min="0"
                    step="0.01"
                    value={approvalData.extraDeliveryFee}
                    onChange={handleApprovalInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    placeholder="e.g. 500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Other Fees (add-ons)</label>
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
                <span className="text-xl font-extrabold text-[#008A45]">
                  ₱{approvalData.newTotal.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="text-sm text-slate-500">
                <p>
                  Down payment (50%):{' '}
                  <span className="font-bold">
                    ₱{(approvalData.newTotal * 0.5).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </p>
                <p className="text-xs mt-1">* Down payment may be required for large orders (subject to business policy).</p>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsApprovalModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFinalizeApproval}
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Approving...' : 'Confirm Approval & Update Total'}
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
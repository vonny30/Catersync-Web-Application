// src/pages/BookingDetails.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, X, Plus, RefreshCw, Edit, Trash2, ClipboardList, Image as ImageIcon, ExternalLink } from 'lucide-react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';

export default function BookingDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [menuSelections, setMenuSelections] = useState([]);
  const [equipment, setEquipment] = useState([]);

  // --- Edit Modal State ---
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [packageCategories, setPackageCategories] = useState([]);
  const [categoryMenuItems, setCategoryMenuItems] = useState({});
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

  // --- Equipment Assignment Modal State ---
  const [isAssignEquipModalOpen, setIsAssignEquipModalOpen] = useState(false);
  const [equipmentList, setEquipmentList] = useState([]);
  const [assignEquipData, setAssignEquipData] = useState({
    equipment_id: '',
    quantity: 1,
    notes: '',
  });
  const [isAssignSubmitting, setIsAssignSubmitting] = useState(false);

  // --- Payment Modal State ---
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [paymentFormData, setPaymentFormData] = useState({
    amount: '',
    pay_installment: 1,
    pay_method: 'Cash',
    pay_status: 'Downpayment',
    pay_proof: 'placeholder.png',
  });

  // --- Cancel Booking Modal State ---
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);

  // --- Helper: Log technical error and show user-friendly toast ---
  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // --- Fetch booking ---
  const fetchBooking = async () => {
    setLoading(true);
    try {
      const { data: bookingData, error: bookingError } = await supabase
        .from('booking')
        .select(`
          *,
          customer:customer_id (first_name, last_name, contact_no, cus_address),
          package:package_id (pkg_name, pkg_price, pkg_description, pricing_type, max_pax, extra_pax_price)
        `)
        .eq('booking_id', id)
        .single();

      if (bookingError) throw bookingError;
      setBooking(bookingData);

      // fetch payments (non‑critical)
      try {
        const { data: paymentsData, error: paymentsError } = await supabase
          .from('payment')
          .select('*')
          .eq('booking_id', id)
          .order('pay_datetime', { ascending: false });
        if (paymentsError) throw paymentsError;
        setPayments(paymentsData || []);
      } catch (e) {
        console.warn('Payments fetch error:', e);
        setPayments([]);
      }

      // fetch menu selections
      try {
        if (
          bookingData.menu_selections &&
          typeof bookingData.menu_selections === 'object' &&
          Object.keys(bookingData.menu_selections).length > 0
        ) {
          const selections = bookingData.menu_selections;
          const categoryIds = Object.keys(selections);
          const menuItemIds = Object.values(selections);

          if (categoryIds.length > 0) {
            const { data: categories, error: catError } = await supabase
              .from('category')
              .select('category_id, category_name')
              .in('category_id', categoryIds);
            if (catError) throw catError;

            const { data: menuItems, error: menuError } = await supabase
              .from('menu_item')
              .select('menu_item_id, menu_name')
              .in('menu_item_id', menuItemIds);
            if (menuError) throw menuError;

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
      } catch (e) {
        console.warn('Menu selections fetch error:', e);
        setMenuSelections([]);
      }

      // fetch equipment assignments
      try {
        const { data: equipData, error: equipError } = await supabase
          .from('booking_equipment')
          .select(`
            assignment_id,
            quantity,
            returned,
            equipment:equipment_id (eqm_name, equipment_id)
          `)
          .eq('booking_id', id)
          .order('assigned_at', { ascending: true });
        if (equipError) throw equipError;
        setEquipment(
          equipData?.map(item => ({
            assignment_id: item.assignment_id,
            equipment_id: item.equipment?.equipment_id,
            eqm_name: item.equipment?.eqm_name || 'Unknown',
            quantity: item.quantity,
            returned: item.returned,
          })) || []
        );
      } catch (e) {
        console.warn('Equipment fetch error:', e);
        setEquipment([]);
      }
    } catch (error) {
      handleError(error, 'Unable to load booking details. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBooking();
    // fetch customers and packages for edit modal
    const fetchDropdownData = async () => {
      try {
        const { data: cust, error: custError } = await supabase
          .from('customer')
          .select('customer_id, first_name, last_name')
          .eq('account_status', 'Active')
          .order('first_name');
        if (custError) throw custError;
        setCustomers(cust || []);

        const { data: pkgs, error: pkgError } = await supabase
          .from('package')
          .select('package_id, pkg_name, pricing_type, max_pax, extra_pax_price')
          .eq('pkg_availability', 'Available')
          .order('pkg_name');
        if (pkgError) throw pkgError;
        setPackages(pkgs || []);
      } catch (error) {
        console.error('Error fetching dropdown data:', error);
        // Non-critical; don't show toast here
      }
    };
    fetchDropdownData();
  }, [id]);

  // --- Approve (with 50% check and payment status sync) ---
  const handleApprove = async () => {
    const confirmed = await showConfirm({
      title: 'Approve Booking?',
      message: 'Are you sure you want to approve this booking? Payment statuses will be set to Downpayment.',
      confirmLabel: 'Approve',
      confirmVariant: 'success',
    });
    if (!confirmed) return;

    try {
      // --- Check 50% payment condition ---
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payment')
        .select('amount_paid')
        .eq('booking_id', id);

      if (paymentsError) throw paymentsError;

      const totalPaid = paymentsData.reduce((sum, p) => sum + (p.amount_paid || 0), 0);
      const totalAmount = booking.total_amount || 0;
      const required = totalAmount * 0.5;

      if (totalPaid < required) {
        toast.error(
          `Cannot approve. Total paid (₱${totalPaid.toFixed(2)}) is less than 50% of the total (₱${required.toFixed(2)}). Please record more payments.`,
          { duration: 6000 }
        );
        return;
      }

      // 1. Update booking status
      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Approved' })
        .eq('booking_id', id);
      if (error) throw error;

      // 2. Update all payments to 'Downpayment' (sync with Approved)
      const { error: updatePaymentsError } = await supabase
        .from('payment')
        .update({ pay_status: 'Downpayment' })
        .eq('booking_id', id);
      if (updatePaymentsError) throw updatePaymentsError;

      // 3. Create an initial payment record if none exists (shouldn't happen, but safe)
      const { data: existingPayments, error: countError } = await supabase
        .from('payment')
        .select('payment_id', { count: 'exact', head: true })
        .eq('booking_id', id);
      if (countError) throw countError;
      if (existingPayments.length === 0) {
        const { error: insertError } = await supabase
          .from('payment')
          .insert([{
            booking_id: id,
            amount_paid: 0,
            pay_installment: 1,
            pay_method: 'Pending',
            pay_status: 'Downpayment',
            pay_datetime: new Date().toISOString(),
            pay_proof: 'placeholder.png',
          }]);
        if (insertError) throw insertError;
      }

      toast.success('Booking approved and payments set to Downpayment.');
      fetchBooking();
    } catch (error) {
      handleError(error, 'Failed to approve booking.');
    }
  };

  const handleReject = async () => {
    const confirmed = await showConfirm({
      title: 'Reject Booking?',
      message: 'Are you sure you want to reject this booking? This will cancel it and cannot be undone.',
      confirmLabel: 'Reject',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Rejected' })
        .eq('booking_id', id);
      if (error) throw error;
      toast.success('Booking rejected.');
      fetchBooking();
    } catch (error) {
      handleError(error, 'Failed to reject booking.');
    }
  };

  // --- Cancel Booking (client-initiated) ---
  const openCancelModal = () => {
    setCancelReason('');
    setIsCancelModalOpen(true);
  };

  const handleCancelBooking = async () => {
    if (!cancelReason.trim()) {
      toast.error('Please provide a cancellation reason.');
      return;
    }

    setIsCancelling(true);
    try {
      const eventDate = booking.event_datetime ? new Date(booking.event_datetime) : null;
      const now = new Date();
      let isRefundable = true;
      let daysUntilEvent = 999;

      if (eventDate) {
        const diffTime = eventDate.getTime() - now.getTime();
        daysUntilEvent = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        isRefundable = daysUntilEvent >= 3;
      }

      const downpaymentPayments = payments.filter(p => p.pay_status === 'Downpayment');
      const totalDownpayment = downpaymentPayments.reduce((sum, p) => sum + p.amount_paid, 0);

      let refundNote = '';
      let shouldRefund = false;

      if (totalDownpayment > 0 && isRefundable) {
        const refundConfirm = await showConfirm({
          title: 'Refund Downpayment?',
          message: `This booking has a downpayment of ₱${totalDownpayment.toLocaleString()}. Since the event is ${daysUntilEvent} days away (>= 3 days), the downpayment is refundable. Do you want to record a refund?`,
          confirmLabel: 'Yes, Refund',
          cancelLabel: 'No, Keep',
          confirmVariant: 'warning',
        });
        shouldRefund = refundConfirm;
        if (shouldRefund) {
          refundNote = 'Downpayment refunded due to client cancellation.';
        } else {
          refundNote = 'Client cancellation – downpayment kept (client declined refund).';
        }
      } else if (totalDownpayment > 0 && !isRefundable) {
        refundNote = `Client cancelled within ${daysUntilEvent} days (< 3 days). Downpayment of ₱${totalDownpayment.toLocaleString()} is non-refundable per policy.`;
      } else {
        refundNote = 'Client cancelled – no downpayment recorded.';
      }

      // Update booking status
      const { error: updateError } = await supabase
        .from('booking')
        .update({
          booking_status: 'Rejected',
          notes: booking.notes ? `${booking.notes}\n\n[CANCELLATION] ${cancelReason}. ${refundNote}` : `[CANCELLATION] ${cancelReason}. ${refundNote}`,
        })
        .eq('booking_id', id);

      if (updateError) throw updateError;

      // Record refund as a negative payment if applicable
      if (shouldRefund && totalDownpayment > 0) {
        const { error: refundError } = await supabase
          .from('payment')
          .insert([{
            booking_id: id,
            amount_paid: -totalDownpayment,
            pay_installment: 1,
            pay_method: 'Refund',
            pay_status: 'Refunded',
            pay_datetime: new Date().toISOString(),
            pay_proof: 'refund_placeholder.png',
          }]);
        if (refundError) throw refundError;
      }

      setIsCancelModalOpen(false);
      fetchBooking();
      toast.success(`Booking cancelled successfully. ${refundNote}`);
    } catch (error) {
      handleError(error, 'Failed to cancel booking.');
    } finally {
      setIsCancelling(false);
    }
  };

  // --- Delete (with payment deletion first) ---
  const handleDelete = async () => {
    const confirmed = await showConfirm({
      title: 'Delete Booking?',
      message: 'Are you sure you want to permanently delete this booking? This action cannot be undone. All associated payments will also be deleted.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    try {
      // FIRST: Delete all associated payments
      const { error: paymentsError } = await supabase
        .from('payment')
        .delete()
        .eq('booking_id', id);
      if (paymentsError) throw paymentsError;

      // THEN: Delete the booking
      const { error } = await supabase
        .from('booking')
        .delete()
        .eq('booking_id', id);
      if (error) throw error;

      toast.success('Booking deleted.');
      navigate('/app/bookings');
    } catch (error) {
      handleError(error, 'Failed to delete booking.');
    }
  };

  // --- Edit Modal Handlers ---
  const openEditModal = () => {
    if (!booking) return;
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
    if (booking.package_id) {
      fetchPackageDetails(booking.package_id);
    } else {
      setPackageCategories([]);
      setCategoryMenuItems({});
    }
    setIsEditModalOpen(true);
  };

  const fetchPackageDetails = async (packageId) => {
    try {
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
      toast.error('Unable to load menu items for this package.');
    }
  };

  const handleEditInputChange = (e) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({ ...prev, [name]: value }));
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
    try {
      // Warn if package changed and equipment may need reallocation
      if (editFormData.package_id !== booking.package_id) {
        const shouldContinue = await showConfirm({
          title: 'Package Changed',
          message: 'You have changed the package. Equipment assignments may need to be updated manually after saving. Continue?',
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
      setIsEditModalOpen(false);
      toast.success('Booking updated successfully!');
      fetchBooking();
    } catch (error) {
      handleError(error, 'Failed to update booking.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Equipment Assignment Handlers ---
  const openAssignEquipModal = () => {
    const fetchEquipmentList = async () => {
      try {
        const { data, error } = await supabase
          .from('equipment')
          .select('equipment_id, eqm_name, quantity_available')
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
    setIsAssignSubmitting(true);
    try {
      const selectedEquip = equipmentList.find(eq => eq.equipment_id === assignEquipData.equipment_id);
      if (!selectedEquip) throw new Error('Equipment not found');
      if (assignEquipData.quantity > selectedEquip.quantity_available) {
        toast.error(`Not enough stock! Only ${selectedEquip.quantity_available} available.`);
        setIsAssignSubmitting(false);
        return;
      }

      const { error: insertError } = await supabase
        .from('booking_equipment')
        .insert([{
          booking_id: id,
          equipment_id: assignEquipData.equipment_id,
          quantity: assignEquipData.quantity,
          notes: assignEquipData.notes || null,
          returned: false,
        }]);
      if (insertError) throw insertError;

      const newQuantity = selectedEquip.quantity_available - assignEquipData.quantity;
      const { error: updateError } = await supabase
        .from('equipment')
        .update({ quantity_available: newQuantity })
        .eq('equipment_id', assignEquipData.equipment_id);
      if (updateError) throw updateError;

      setIsAssignEquipModalOpen(false);
      fetchBooking();
      toast.success('Equipment assigned successfully!');
    } catch (error) {
      handleError(error, 'Failed to assign equipment.');
    } finally {
      setIsAssignSubmitting(false);
    }
  };

  // --- Remove Equipment Assignment ---
  const handleRemoveEquipment = async (assignmentId, equipmentId, quantity) => {
    const confirmed = await showConfirm({
      title: 'Remove Equipment?',
      message: 'Are you sure you want to remove this equipment assignment? Stock will be restored.',
      confirmLabel: 'Remove',
      confirmVariant: 'warning',
    });
    if (!confirmed) return;

    try {
      const { error: deleteError } = await supabase
        .from('booking_equipment')
        .delete()
        .eq('assignment_id', assignmentId);
      if (deleteError) throw deleteError;

      const { data: equipData, error: fetchError } = await supabase
        .from('equipment')
        .select('quantity_available')
        .eq('equipment_id', equipmentId)
        .single();
      if (fetchError) throw fetchError;

      const newQuantity = equipData.quantity_available + quantity;
      const { error: updateError } = await supabase
        .from('equipment')
        .update({ quantity_available: newQuantity })
        .eq('equipment_id', equipmentId);
      if (updateError) throw updateError;

      fetchBooking();
      toast.success('Equipment removed and stock restored.');
    } catch (error) {
      handleError(error, 'Failed to remove equipment.');
    }
  };

  // --- Payment Handlers ---
  const openPaymentModal = () => {
    setPaymentFormData({
      amount: '',
      pay_installment: 1,
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

    try {
      let proofUrl = 'placeholder.png';

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
          setIsPaymentSubmitting(false);
          return;
        }
        setUploading(false);
      }

      const payload = {
        booking_id: id,
        amount_paid: parseFloat(paymentFormData.amount) || 0,
        pay_installment: parseInt(paymentFormData.pay_installment) || 1,
        pay_method: paymentFormData.pay_method,
        pay_status: paymentFormData.pay_status,
        pay_datetime: new Date().toISOString(),
        pay_proof: proofUrl,
      };

      const { error } = await supabase
        .from('payment')
        .insert([payload]);
      if (error) throw error;

      setIsPaymentModalOpen(false);
      fetchBooking();
      toast.success('Payment recorded successfully!');
    } catch (error) {
      handleError(error, 'Failed to record payment.');
    } finally {
      setIsPaymentSubmitting(false);
      setUploading(false);
    }
  };

  // --- Render ---
  if (loading) return <div className="p-12 text-center text-slate-500 font-medium">Loading...</div>;
  if (!booking) return <div className="p-12 text-center text-slate-500">Booking not found.</div>;

  const totalPaid = payments.reduce((sum, p) => sum + (p.amount_paid || 0), 0);
  const remainingBalance = Math.max(0, (booking.total_amount || 0) - totalPaid);
  const downpaymentPaid = payments
    .filter(p => p.pay_status === 'Downpayment')
    .reduce((sum, p) => sum + p.amount_paid, 0);

  const eventDate = booking.event_datetime ? new Date(booking.event_datetime) : null;
  const now = new Date();
  let daysUntilEvent = null;
  let isRefundable = true;
  if (eventDate) {
    const diffTime = eventDate.getTime() - now.getTime();
    daysUntilEvent = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    isRefundable = daysUntilEvent >= 3;
  }

  const canCancel = booking.booking_status === 'Approved';

  // Helper to render proof image
  const renderProof = (proofUrl) => {
    if (!proofUrl || proofUrl === 'placeholder.png' || proofUrl === 'refund_placeholder.png') {
      return <span className="text-xs text-slate-400 italic">None</span>;
    }
    return (
      <button
        onClick={() => window.open(proofUrl, '_blank')}
        className="w-8 h-8 rounded border border-slate-200 overflow-hidden hover:shadow-md transition-shadow cursor-pointer flex items-center justify-center bg-slate-50"
        title="Click to view proof"
      >
        <img
          src={proofUrl}
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
            <p className="text-xs text-slate-500">Booking ID: {booking.booking_id}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {booking.booking_status === 'Pending' && (
            <>
              <button onClick={handleApprove} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm">
                <Check size={18} /> Approve
              </button>
              <button onClick={handleReject} className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm">
                <X size={18} /> Reject
              </button>
            </>
          )}
          {canCancel && (
            <button
              onClick={openCancelModal}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
            >
              <X size={18} /> Cancel Booking
            </button>
          )}
          <button
            onClick={openEditModal}
            className="bg-white border border-slate-300 text-slate-700 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors"
          >
            <Edit size={16} /> Edit
          </button>
          <button
            onClick={handleDelete}
            className="bg-white border border-red-300 text-red-600 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={16} /> Delete
          </button>
          <button onClick={fetchBooking} className="bg-white border border-slate-300 text-slate-700 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Status Badge */}
      <div>
        <span className={`px-4 py-1.5 rounded-full text-xs font-bold border ${(
          booking.booking_status === 'Pending' ? 'bg-amber-50 border-amber-200 text-amber-700' :
          booking.booking_status === 'Approved' ? 'bg-[#EAF3F2] border-[#C1DEDC] text-slate-800' :
          booking.booking_status === 'Completed' ? 'bg-blue-50 border-blue-200 text-blue-700' :
          'bg-red-50 border-red-200 text-red-700'
        )}`}>
          {booking.booking_status}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Event Details</h3>
            <div className="space-y-2.5 text-sm">
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Date</span><span className="col-span-2">{booking.event_datetime ? new Date(booking.event_datetime).toLocaleString() : 'N/A'}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Venue</span><span className="col-span-2">{booking.venue || 'N/A'}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Pax</span><span className="col-span-2">{booking.pax_count}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Package</span><span className="col-span-2">{booking.package?.pkg_name || 'None'}</span></div>
              
              {/* Pricing Model Section */}
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

              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Color</span><span className="col-span-2">{booking.motif_color || 'N/A'}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Total</span><span className="col-span-2 font-bold">₱{booking.total_amount?.toLocaleString() || '0'}</span></div>
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
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Name</span><span className="col-span-2">{booking.customer?.first_name} {booking.customer?.last_name}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Contact</span><span className="col-span-2">{booking.customer?.contact_no || 'N/A'}</span></div>
              <div className="grid grid-cols-3"><span className="text-slate-700 font-bold">Address</span><span className="col-span-2">{booking.customer?.cus_address || 'N/A'}</span></div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-7 space-y-6">
          {/* Payment Tracking */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-900">Payment Tracking</h3>
              <button
                onClick={openPaymentModal}
                className="bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <Plus size={14} /> Record Payment
              </button>
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
              <span className="font-bold text-[#008A45]">₱{totalPaid.toLocaleString()}</span>
            </div>
            <div className={`rounded-lg p-3 flex justify-between items-center text-sm border ${(
              remainingBalance <= 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
            )}`}>
              <span className="font-medium text-slate-700">Remaining Balance:</span>
              <span className={`font-bold ${remainingBalance <= 0 ? 'text-green-700' : 'text-amber-700'}`}>
                ₱{remainingBalance.toLocaleString()}
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
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${(
                            p.pay_status === 'Refunded' ? 'bg-red-100 text-red-700 border border-red-200' :
                            p.pay_status === 'Fully Paid' ? 'bg-green-100 text-green-700 border border-green-200' :
                            'bg-amber-100 text-amber-700 border border-amber-200'
                          )}`}>
                            {p.pay_status || 'N/A'}
                          </span>
                        </td>
                        <td className="p-3">{renderProof(p.pay_proof)}</td>
                        <td className="p-3">{p.pay_datetime ? new Date(p.pay_datetime).toLocaleString() : 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors shadow-sm"
                >
                  <ClipboardList size={14} /> Assign Equipment
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
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${(
                        item.returned ? 'bg-green-100 border border-green-200 text-green-700' : 'bg-amber-100 border border-amber-200 text-amber-700'
                      )}`}>
                        {item.returned ? '✅ Returned' : '📌 Assigned'}
                      </span>
                      {!item.returned && (
                        <button
                          onClick={() => handleRemoveEquipment(item.assignment_id, item.equipment_id, item.quantity)}
                          className="text-red-400 hover:text-red-600 transition-colors"
                          title="Remove this equipment assignment"
                        >
                          <Trash2 size={16} />
                        </button>
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
                  onChange={(e) => {
                    handleEditInputChange(e);
                    fetchPackageDetails(e.target.value);
                  }}
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
                  <p className="text-xs text-amber-600 mt-1">⚠️ Changing package may require manual equipment reallocation.</p>
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
                <input
                  type="datetime-local"
                  name="event_datetime"
                  value={editFormData.event_datetime}
                  onChange={handleEditInputChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Venue</label>
                <input
                  type="text"
                  name="venue"
                  value={editFormData.venue}
                  onChange={handleEditInputChange}
                  placeholder="e.g. Grand Pavilion"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                />
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
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                  />
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">Total Amount</label>
                  <input
                    type="number"
                    name="total_amount"
                    value={editFormData.total_amount}
                    onChange={handleEditInputChange}
                    placeholder="0.00"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                  />
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
                <p><span className="font-medium">Booking:</span> {booking.booking_id.slice(0, 8)} – {booking.customer?.first_name} {booking.customer?.last_name}</p>
                <p className="text-xs text-slate-500 mt-1">Equipment will be assigned to this booking only.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Select Equipment</label>
                  <select
                    name="equipment_id"
                    value={assignEquipData.equipment_id}
                    onChange={handleAssignEquipChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none font-medium text-slate-800"
                    required
                  >
                    <option value="">Choose equipment...</option>
                    {equipmentList.map((eq) => (
                      <option key={eq.equipment_id} value={eq.equipment_id} disabled={eq.quantity_available === 0}>
                        {eq.eqm_name} ({eq.quantity_available} available)
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
              {/* Booking Details Preview */}
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
                  <span className="text-slate-900 font-semibold">₱{totalPaid.toLocaleString()}</span>
                  <span className="text-slate-600 font-medium">Remaining:</span>
                  <span className={`font-semibold ${remainingBalance <= 0 ? 'text-green-700' : 'text-amber-700'}`}>
                    ₱{remainingBalance.toLocaleString()}
                  </span>
                  <span className="text-slate-600 font-medium">Status:</span>
                  <span className="text-slate-900 font-semibold capitalize">{booking.booking_status || 'N/A'}</span>
                </div>
              </div>

              {/* Payment Details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Installment #</label>
                  <input
                    type="number"
                    name="pay_installment"
                    value={paymentFormData.pay_installment}
                    onChange={handlePaymentInputChange}
                    min="1"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  />
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
                      onClick={() => setPaymentFormData(prev => ({ ...prev, pay_method: method }))}
                      className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-sm font-semibold transition-all ${(
                        paymentFormData.pay_method === method
                          ? 'bg-[#CBDEDD]/60 border-[#008A45] text-slate-900 shadow-xs'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                      )}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${paymentFormData.pay_method === method ? 'border-[#008A45]' : 'border-slate-400'}`}>
                        {paymentFormData.pay_method === method && <div className="w-1.5 h-1.5 rounded-full bg-[#008A45]" />}
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
                  <input type="file" onChange={handlePaymentFileChange} accept="image/*" className="hidden" />
                  <ImageIcon size={20} className="text-slate-400 mb-1" />
                  <span className="text-xs font-semibold text-slate-600">
                    {selectedFile ? selectedFile.name : 'Upload Image'}
                  </span>
                  <span className="text-[10px] text-slate-400 mt-0.5">PNG, JPG up to 5MB</span>
                </label>
                <p className="text-xs text-slate-400 mt-1">Upload a proof image; will be stored in Supabase Storage.</p>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPaymentSubmitting || uploading}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : (isPaymentSubmitting ? 'Saving...' : 'Record Payment')}
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
              {/* Warning / Info */}
              <div className={`p-3 rounded-lg text-sm border ${(
                eventDate && daysUntilEvent < 3 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'
              )}`}>
                <p className="font-bold">Event Date: {eventDate ? new Date(eventDate).toLocaleString() : 'N/A'}</p>
                {eventDate && daysUntilEvent !== null && (
                  <p>
                    {daysUntilEvent >= 0
                      ? `${daysUntilEvent} days until event`
                      : 'Event has already passed'}
                  </p>
                )}
                {eventDate && daysUntilEvent !== null && daysUntilEvent < 3 && daysUntilEvent >= 0 && (
                  <p className="font-bold mt-1 text-red-600">⚠️ Cancellation is within 3 days – downpayment is NON-REFUNDABLE per policy.</p>
                )}
                {eventDate && daysUntilEvent !== null && daysUntilEvent >= 3 && (
                  <p className="font-bold mt-1 text-green-700">✅ Cancellation is 3+ days before event – downpayment IS refundable.</p>
                )}
                {downpaymentPaid > 0 && (
                  <p className="mt-1">Downpayment paid: <span className="font-bold">₱{downpaymentPaid.toLocaleString()}</span></p>
                )}
              </div>

              {/* Cancellation Reason */}
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
    </div>
  );
}
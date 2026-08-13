// src/hooks/useApprovalHandlers.js
import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { allocateEquipmentForBooking, checkEquipmentCapacityForDate } from '../utils/equipment';

export function useApprovalHandlers({ booking, payments, fetchData }) {
  const { showConfirm } = useConfirm();
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [approvalBooking, setApprovalBooking] = useState(null);
  const [approvalData, setApprovalData] = useState({
    extraPax: 0,
    additionalFee: 0,
    newTotal: 0,
    baseTotal: 0,
    extraQuantity: 0,
    extraDeliveryFee: 0,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [approvalType, setApprovalType] = useState('package');

  // --- ROBUST base total computation ---
  const computeBaseTotal = async (booking) => {
    // 1. If the booking already has a valid total, use it
    if (booking.total_amount && booking.total_amount > 0) {
      return booking.total_amount;
    }

    // 2. Try to compute from package (either preloaded or query)
    let pkg = booking.package;
    
    // If not preloaded and we have a package_id, fetch it
    if (!pkg && booking.package_id) {
      try {
        const { data, error } = await supabase
          .from('package')
          .select('pkg_price, pricing_type, max_pax, extra_pax_price, minimum_pax')
          .eq('package_id', booking.package_id)
          .single();
        if (!error && data) {
          pkg = data;
          // Attach to booking for future use
          booking.package = data;
        }
      } catch (fetchError) {
        console.warn('Failed to fetch package data:', fetchError);
      }
    }

    if (pkg) {
      const pax = booking.pax_count || 0;
      if (pkg.pricing_type === 'per_pax') {
        const basePrice = pkg.pkg_price || 0;
        return basePrice * pax;
      } else {
        // fixed price
        let total = pkg.pkg_price || 0;
        if (pkg.max_pax && pax > pkg.max_pax) {
          total += (pax - pkg.max_pax) * (pkg.extra_pax_price || 0);
        }
        return total;
      }
    }

    // 3. Fallback – use booking's total_amount
    if (booking.total_amount && booking.total_amount > 0) {
      return booking.total_amount;
    }

    // 4. Last resort – log warning and return 0
    console.warn('Could not compute base total for booking:', booking.booking_id);
    return 0;
  };

  const openApprovalModal = async (booking, type = 'package') => {
    setApprovalType(type);
    const baseTotal = await computeBaseTotal(booking);

    const initData = {
      extraPax: 0,
      additionalFee: 0,
      newTotal: baseTotal,
      baseTotal: baseTotal,
      extraQuantity: 0,
      extraDeliveryFee: 0,
    };

    setApprovalBooking(booking);
    setApprovalData(initData);
    setIsApprovalModalOpen(true);
  };


  const handleApprovalInputChange = (e) => {
    const { name, value } = e.target;
    const numValue = parseFloat(value) || 0;
    setApprovalData(prev => {
      const updated = { ...prev, [name]: numValue };
      let newTotal = updated.baseTotal;
      if (approvalType === 'package') {
        const pkgPrice = approvalBooking?.package?.pkg_price || 0;
        const extraPaxCost = (updated.extraPax || 0) * pkgPrice;
        newTotal = updated.baseTotal + extraPaxCost + (updated.additionalFee || 0);
      } else {
        // ✅ Now extraQuantity and extraDeliveryFee are guaranteed to exist
        newTotal = updated.baseTotal + (updated.extraQuantity || 0) + (updated.extraDeliveryFee || 0) + (updated.additionalFee || 0);
      }
      return { ...updated, newTotal };
    });
  };

  const handleFinalizeApproval = async () => {
    if (!approvalBooking) return;
    setIsSubmitting(true);

    try {
      // 1. Check 50% payment (warning only)
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payment')
        .select('amount_paid')
        .eq('booking_id', approvalBooking.booking_id);
      if (paymentsError) throw paymentsError;
      const totalPaid = paymentsData.reduce((sum, p) => sum + (p.amount_paid || 0), 0);
      const required = approvalData.newTotal * 0.5;
      if (totalPaid < required) {
        const proceed = await showConfirm({
          title: '⚠️ Insufficient Downpayment',
          message: `Total paid (₱${totalPaid.toFixed(2)}) is less than 50% of the total (₱${required.toFixed(2)}).\n\nApproving this booking may leave an unpaid balance.\nDo you still want to approve?`,
          confirmLabel: 'Yes, Approve',
          cancelLabel: 'Cancel',
          confirmVariant: 'warning',
        });
        if (!proceed) {
          setIsSubmitting(false);
          return;
        }
      }

      // 2. Conflict check: other approved events on same day
      const eventDate = approvalBooking.event_datetime ? new Date(approvalBooking.event_datetime) : null;
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
          .select(`booking_id, booking_type, venue, event_datetime, customer:customer_id (first_name, last_name)`)
          .eq('booking_status', 'Approved')
          .neq('booking_id', approvalBooking.booking_id)
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
            message: `The following events are already approved on ${eventDate.toLocaleDateString()}:\n\n${list}\n\nDo you still want to approve this booking?`,
            confirmLabel: 'Approve Anyway',
            cancelLabel: 'Cancel',
            confirmVariant: 'warning',
          });
          if (!proceed) {
            setIsSubmitting(false);
            return;
          }
        }
      }

      // 3. Update booking – compute new total properly
      let updatePayload = { booking_status: 'Approved' };
      if (approvalType === 'package') {
        const newPax = approvalBooking.pax_count + (approvalData.extraPax || 0);
        updatePayload.pax_count = newPax;
        updatePayload.total_amount = approvalData.newTotal;
      } else {
        const newDeliveryFee = parseFloat(approvalBooking.delivery_fee || 0) + (approvalData.extraDeliveryFee || 0);
        updatePayload.total_amount = approvalData.newTotal;
        updatePayload.delivery_fee = newDeliveryFee;
        const note = approvalBooking.notes ? `${approvalBooking.notes}\n[APPROVAL] Adjusted total: ₱${approvalData.newTotal}` : `[APPROVAL] Adjusted total: ₱${approvalData.newTotal}`;
        updatePayload.notes = note;
      }
      const { error: updateError } = await supabase
        .from('booking')
        .update(updatePayload)
        .eq('booking_id', approvalBooking.booking_id);
      if (updateError) throw updateError;

      // 4. Allocate equipment (only for packages)
      if (approvalType === 'package' && approvalBooking.package_id) {
        try {
          await allocateEquipmentForBooking(approvalBooking.booking_id, approvalBooking.package_id, approvalBooking.pax_count + (approvalData.extraPax || 0));
        } catch (allocError) {
          console.warn('Equipment allocation warning:', allocError);
          toast.warning('Equipment allocation had issues: ' + allocError.message);
        }
      }

      // ✅ 5. Update payments – set to Fully Paid if already paid in full, else Downpayment
      const { data: existingPayments, error: fetchPaymentsError } = await supabase
        .from('payment')
        .select('amount_paid')
        .eq('booking_id', approvalBooking.booking_id);
      if (fetchPaymentsError) throw fetchPaymentsError;

      const paidTotal = existingPayments.reduce((sum, p) => sum + p.amount_paid, 0);
      const newTotal = approvalData.newTotal;
      const newStatus = (paidTotal >= newTotal && paidTotal > 0) ? 'Fully Paid' : 'Downpayment';

      const { error: updatePaymentsError } = await supabase
        .from('payment')
        .update({ pay_status: newStatus })
        .eq('booking_id', approvalBooking.booking_id);
      if (updatePaymentsError) throw updatePaymentsError;

      // 6. Equipment capacity check (packages only)
      if (approvalType === 'package' && approvalBooking.package_id) {
        try {
          const eventDate = approvalBooking.event_datetime;
          const shortages = await checkEquipmentCapacityForDate(eventDate, approvalBooking.booking_id);
          if (shortages.length > 0) {
            const details = shortages.map(s => `${s.eqm_name}: needed ${s.needed}, available ${s.available}`).join('\n');
            const override = await showConfirm({
              title: '⚠️ Equipment Shortage',
              message: `The following items are insufficient for this date:\n\n${details}\n\nOverride may cause issues on event day.\nDo you still want to approve?`,
              confirmLabel: 'Override & Approve',
              cancelLabel: 'Cancel Approval',
              confirmVariant: 'danger',
            });
            if (!override) {
              await supabase
                .from('booking')
                .update({ booking_status: 'Pending' })
                .eq('booking_id', approvalBooking.booking_id);
              await supabase.from('booking_equipment').delete().eq('booking_id', approvalBooking.booking_id);
              setIsSubmitting(false);
              return;
            } else {
              await supabase
                .from('booking')
                .update({ notes: `${approvalBooking.notes || ''}\n[WARNING] Equipment overbooked for this date.` })
                .eq('booking_id', approvalBooking.booking_id);
            }
          }
        } catch (capError) {
          console.warn('Equipment capacity check failed:', capError);
        }
      }

      setIsApprovalModalOpen(false);
      fetchData();
      toast.success(`Booking approved. Payments marked as ${newStatus}.`);
    } catch (error) {
      console.error(error);
      toast.error('Failed to approve booking.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    isApprovalModalOpen,
    setIsApprovalModalOpen,
    approvalBooking,
    approvalData,
    isSubmitting,
    approvalType,
    openApprovalModal,
    handleApprovalInputChange,
    handleFinalizeApproval,
  };
}
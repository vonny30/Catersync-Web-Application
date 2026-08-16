// src/hooks/useApprovalHandlers.js
import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { allocateEquipmentForBooking, checkEquipmentCapacityForDate } from '../utils/equipment';
import { sumVerifiedPositivePayments } from '../utils/payments';
import { ACTIVE_BOOKING_STATUSES } from '../utils/bookingStatus';

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
    // Clamp to >= 0 — the "min" HTML attribute doesn't actually block
    // typing a negative number, and a negative extraPax/fee here would
    // silently shrink the total (or the effective pax count) below the
    // booking's real value.
    const numValue = Math.max(0, parseFloat(value) || 0);
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
      // Note: approval no longer checks payment status — in the Updated
      // Flow, payment only happens AFTER a booking is approved, so there's
      // nothing to warn about here. Any confirmation the manager needs
      // before approving belongs earlier (Day Availability / Equipment
      // Availability panels), not as a payment warning at this step.

      // 1. Conflict check: other approved events on same day
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
          .in('booking_status', ACTIVE_BOOKING_STATUSES)
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

      // Snapshot of what this booking looked like before we touch it, so a
      // cancel further down (equipment shortage) can put it back exactly
      // as it was — not just the status, but pax/total/fee/notes too.
      const originalBookingSnapshot = {
        pax_count: approvalBooking.pax_count,
        total_amount: approvalBooking.total_amount,
        delivery_fee: approvalBooking.delivery_fee,
        notes: approvalBooking.notes,
      };

      // 2. Update booking – compute new total properly
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

      // 3. Allocate equipment (only for packages)
      if (approvalType === 'package' && approvalBooking.package_id) {
        try {
          await allocateEquipmentForBooking(approvalBooking.booking_id, approvalBooking.package_id, approvalBooking.pax_count + (approvalData.extraPax || 0));
        } catch (allocError) {
          console.warn('Equipment allocation warning:', allocError);
          toast.warning('Equipment allocation had issues: ' + allocError.message);
        }
      }

      // ✅ 4. Update already-verified payments – set to Fully Paid if paid in
      // full, else Downpayment. Pending Verification / Proof Rejected rows
      // are left alone — approval doesn't verify payments for you.
      const { data: existingPayments, error: fetchPaymentsError } = await supabase
        .from('payment')
        .select('payment_id, amount_paid, pay_status')
        .eq('booking_id', approvalBooking.booking_id);
      if (fetchPaymentsError) throw fetchPaymentsError;

      const paidTotal = sumVerifiedPositivePayments(existingPayments);
      const newTotal = approvalData.newTotal;
      const newStatus = (paidTotal >= newTotal && paidTotal > 0) ? 'Fully Paid' : 'Downpayment';

      // Remember exactly which rows we're about to touch and what they
      // were before, so a cancel further down can put them back — a
      // Pending booking shouldn't be left with payments already marked
      // Downpayment/Fully Paid from an approval that didn't go through.
      const touchedPaymentSnapshots = (existingPayments || [])
        .filter(p => ['Downpayment', 'Fully Paid'].includes(p.pay_status))
        .map(p => ({ payment_id: p.payment_id, pay_status: p.pay_status }));

      if (paidTotal > 0) {
        const { error: updatePaymentsError } = await supabase
          .from('payment')
          .update({ pay_status: newStatus })
          .eq('booking_id', approvalBooking.booking_id)
          .in('pay_status', ['Downpayment', 'Fully Paid']);
        if (updatePaymentsError) throw updatePaymentsError;
      }

      // 5. Equipment capacity check (packages only)
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
              // Full rollback: booking status AND the pax/total/fee/notes
              // this approval attempt had already written, plus any
              // payment rows it had already marked Downpayment/Fully Paid
              // — otherwise a cancelled approval leaves the booking back
              // at Pending but with post-approval numbers stuck on it.
              await supabase
                .from('booking')
                .update({ booking_status: 'Pending', ...originalBookingSnapshot })
                .eq('booking_id', approvalBooking.booking_id);
              await supabase.from('booking_equipment').delete().eq('booking_id', approvalBooking.booking_id);
              for (const p of touchedPaymentSnapshots) {
                await supabase
                  .from('payment')
                  .update({ pay_status: p.pay_status })
                  .eq('payment_id', p.payment_id);
              }
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
      toast.success(paidTotal > 0 ? `Booking approved. Payments marked as ${newStatus}.` : 'Booking approved. The customer can now proceed to payment.');
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
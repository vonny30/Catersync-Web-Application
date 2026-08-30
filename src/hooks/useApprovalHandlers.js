// src/hooks/useApprovalHandlers.js
import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { allocateEquipmentForBooking, getEquipmentAvailabilityPreview } from '../utils/equipment';
import { allocateVehiclesForBooking } from '../utils/vehicle';
import { sumVerifiedPositivePayments } from '../utils/payments';
import { ACTIVE_BOOKING_STATUSES, MAX_SHORT_ORDERS_PER_DAY, STATUS_ORDER } from '../utils/bookingStatus';

export function useApprovalHandlers({ booking, payments, fetchData }) {
  const { showConfirm } = useConfirm();
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [approvalBooking, setApprovalBooking] = useState(null);
  // Which vehicles the manager settled on in the approval panel. null means
  // they did not touch it, so the suggestion stands; an array — including an
  // empty one — is a decision and is honoured as given.
  const [approvalVehicleIds, setApprovalVehicleIds] = useState(null);
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
    // Each approval starts from the suggestion again — a set chosen for the
    // last booking must not carry over to the next one.
    setApprovalVehicleIds(null);
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

      // 1. Past-date warning — still a soft check, since approving a
      // backdated event doesn't put stock or capacity at risk, just reports.
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
      }

      // 1.5 Equipment hard-block: don't allow approval at all if there isn't
      // enough physical stock for this booking, given what's already
      // committed to other Approved/Confirmed bookings on the same date.
      // This is the same data the Equipment Allocation panel shows in the
      // modal — no "Override & Approve" here, since approving anyway is
      // exactly how a shortage on event day happens. The manager has to
      // either free up stock on the Equipment page or resolve the
      // conflicting booking first, then come back and approve.
      if (approvalType === 'package' && approvalBooking.package_id && approvalBooking.event_datetime) {
        const effectivePax = approvalBooking.pax_count + (approvalData.extraPax || 0);
        const preview = await getEquipmentAvailabilityPreview(
          approvalBooking.event_datetime,
          approvalBooking.package_id,
          effectivePax,
          approvalBooking.booking_id
        );
        const shortages = preview.filter(item => !item.sufficient);
        if (shortages.length > 0) {
          const details = shortages
            .map(s => `• ${s.eqm_name} — needs ${s.needed}, only ${s.freeBeforeThis} free of ${s.totalStock} total`)
            .join('\n');
          await showConfirm({
            title: 'Not Enough Equipment for This Date',
            message: `This booking can't be approved yet — the following items don't have enough stock left for ${eventDate ? eventDate.toLocaleDateString() : 'this date'}:\n\n${details}\n\nIncrease the stock on the Equipment page, or free it up by resolving the conflicting booking, then approve again.`,
            confirmLabel: 'Got it',
            cancelLabel: 'Close',
            confirmVariant: 'danger',
          });
          setIsSubmitting(false);
          return;
        }
      }

      // 1.6 Short Order daily-capacity hard-block: the kitchen can only
      // handle MAX_SHORT_ORDERS_PER_DAY Short Orders on any one calendar
      // day. Same "no override" pattern as the equipment block above —
      // the manager has to resolve/reject a conflicting order first, then
      // come back and approve.
      if (approvalType === 'shortorder' && approvalBooking.event_datetime) {
        const startOfDay = new Date(approvalBooking.event_datetime);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(approvalBooking.event_datetime);
        endOfDay.setHours(23, 59, 59, 999);

        const { count: sameDayCount, error: countError } = await supabase
          .from('booking')
          .select('*', { count: 'exact', head: true })
          .eq('booking_type', 'Short Order')
          .in('booking_status', ACTIVE_BOOKING_STATUSES)
          .gte('event_datetime', startOfDay.toISOString())
          .lte('event_datetime', endOfDay.toISOString())
          .neq('booking_id', approvalBooking.booking_id);
        if (countError) throw countError;

        if ((sameDayCount || 0) >= MAX_SHORT_ORDERS_PER_DAY) {
          await showConfirm({
            title: 'Daily Short Order Limit Reached',
            message: `${eventDate ? eventDate.toLocaleDateString() : 'This date'} already has ${sameDayCount} approved Short Order(s) — the maximum is ${MAX_SHORT_ORDERS_PER_DAY} per day. This order can't be approved for this date.\n\nEither reschedule it to a different date, or resolve/reject one of the other orders on this date first.`,
            confirmLabel: 'Got it',
            cancelLabel: 'Close',
            confirmVariant: 'danger',
          });
          setIsSubmitting(false);
          return;
        }
      }

      // 2. Update booking – compute new total properly. Also clears the
      // "NEW" badge/bold-row state — is_read is otherwise only flipped by
      // clicking into the row or opening the detail page, so a booking
      // acted on straight from a modal (like this one) would otherwise
      // keep showing as unread forever despite clearly being handled.
      let updatePayload = { booking_status: 'Approved', status_order: STATUS_ORDER.Approved, is_read: true };
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
          toast('Equipment allocation had issues: ' + allocError.message, { icon: '⚠️' });
        }
      }

      // 3b. Allocate vehicles — both booking types, since short orders are
      // delivered too. This runs AFTER the equipment step on purpose: the
      // fleet is sized partly from the equipment units just allocated.
      //
      // Approval order is the dispatch order. Everything already on a vehicle
      // was approved before this booking and keeps its slot; this one queues
      // behind it, and the chain is re-timed so every setup still finishes
      // before its own event starts.
      try {
        const dispatch = await allocateVehiclesForBooking({
          ...approvalBooking,
          pax_count: approvalBooking.pax_count + (approvalData.extraPax || 0),
        }, approvalVehicleIds);
        if (dispatch.shortfall) {
          toast(
            `Approved, but only ${dispatch.picks.length} of ${dispatch.shortfall.needed} vehicle(s) could be scheduled. Assign the rest from the Vehicles page.`,
            { icon: '⚠️', duration: 8000 }
          );
        } else if (dispatch.pickupsSkipped) {
          toast('Vehicles dispatched. Add the collection run manually — it could not be saved automatically.', { icon: '⚠️', duration: 7000 });
        }
      } catch (vehicleError) {
        // Never fail an approval over dispatch. The booking is approved; the
        // Vehicles page still lets a manager assign by hand.
        console.warn('Vehicle allocation warning:', vehicleError);
        toast('Approved, but no vehicle was assigned: ' + vehicleError.message, { icon: '⚠️', duration: 8000 });
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

      if (paidTotal > 0) {
        const { error: updatePaymentsError } = await supabase
          .from('payment')
          .update({ pay_status: newStatus })
          .eq('booking_id', approvalBooking.booking_id)
          .in('pay_status', ['Downpayment', 'Fully Paid']);
        if (updatePaymentsError) throw updatePaymentsError;
      }

      setIsApprovalModalOpen(false);
      fetchData();
      const noun = approvalType === 'shortorder' ? 'Order' : 'Booking';
      toast.success(paidTotal > 0 ? `${noun} approved. Payments marked as ${newStatus}.` : `${noun} approved. The customer can now proceed to payment.`);
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
    approvalVehicleIds,
    setApprovalVehicleIds,
  };
}
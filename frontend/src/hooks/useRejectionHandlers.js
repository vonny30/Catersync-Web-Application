import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';

export function useRejectionHandlers({ booking, payments, fetchData }) {
  const { showConfirm } = useConfirm();
  const [isRejectionModalOpen, setIsRejectionModalOpen] = useState(false);
  const [rejectionBookingId, setRejectionBookingId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionRefundAmount, setRejectionRefundAmount] = useState('');
  const [rejectionRefundRemarks, setRejectionRefundRemarks] = useState('');
  const [rejectionRefundFile, setRejectionRefundFile] = useState(null);
  const [showRejectionRefund, setShowRejectionRefund] = useState(false);
  const [rejectionMaxRefundable, setRejectionMaxRefundable] = useState(0);

  const openRejectionModal = async (id) => {
    const b = booking; // the booking object (could be package or short order)
    const positivePayments = payments
      .filter(p => p.amount_paid > 0)
      .reduce((sum, p) => sum + p.amount_paid, 0);
    const downpaymentPayments = payments.filter(p => p.pay_status === 'Downpayment' && p.amount_paid > 0);
    const totalDownpayment = downpaymentPayments.reduce((sum, p) => sum + p.amount_paid, 0);

    let warningMessage = 'Are you sure you want to reject this booking? This will cancel it and cannot be undone.';
    if (positivePayments > 0) {
      const totalAmount = b.total_amount || 0;
      const percentage = totalAmount > 0 ? (positivePayments / totalAmount) * 100 : 0;
      warningMessage = `This booking has payments totaling ₱${positivePayments.toLocaleString()} (${percentage.toFixed(1)}% of total). Rejecting will keep the payments recorded. You may need to process refunds separately. Do you still want to reject?`;
    }
    const confirmed = await showConfirm({
      title: 'Reject Booking?',
      message: warningMessage,
      confirmLabel: 'Yes, Continue',
      cancelLabel: 'Cancel',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const eventDate = b.event_datetime ? new Date(b.event_datetime) : null;
    let isRefundable = false;
    if (eventDate) {
      const now = new Date();
      const diffTime = eventDate.getTime() - now.getTime();
      const daysUntilEvent = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      isRefundable = daysUntilEvent >= 3;
    }

    let maxRefundable = 0;
    if (isRefundable) {
      maxRefundable = positivePayments;
    } else {
      maxRefundable = Math.max(0, positivePayments - totalDownpayment);
    }

    setRejectionBookingId(id);
    setRejectionMaxRefundable(maxRefundable);
    setShowRejectionRefund(maxRefundable > 0);
    setRejectionReason('');
    setRejectionRefundAmount('');
    setRejectionRefundRemarks('');
    setRejectionRefundFile(null);
    setIsRejectionModalOpen(true);
  };

  const handleRejectConfirm = async () => {
    const id = rejectionBookingId;
    if (!id) return;
    const b = booking; // the booking object
    if (!b) return;

    let enteredAmount = 0;
    let proofUrl = 'refund_placeholder.png';

    if (showRejectionRefund) {
      enteredAmount = parseFloat(rejectionRefundAmount) || 0;
      if (enteredAmount > 0) {
        if (enteredAmount > rejectionMaxRefundable) {
          toast.error(`Refund amount cannot exceed ₱${rejectionMaxRefundable.toLocaleString()}.`);
          return;
        }
        if (!rejectionRefundFile) {
          toast.error('Please upload a proof of refund receipt.');
          return;
        }
        const fileExt = rejectionRefundFile.name.split('.').pop();
        const fileName = `refunds/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('images')
          .upload(fileName, rejectionRefundFile);
        if (uploadError) {
          toast.error('Failed to upload refund proof. Please try again.');
          return;
        }
        const { data: publicUrlData } = supabase.storage
          .from('images')
          .getPublicUrl(fileName);
        proofUrl = publicUrlData.publicUrl;
      }
    }

    setIsRejectionModalOpen(false);

    try {
      const reasonText = rejectionReason.trim() || 'No reason provided';
      let updatedNotes = b.notes ? `${b.notes}\n[REJECTION] ${reasonText}` : `[REJECTION] ${reasonText}`;

      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Rejected', notes: updatedNotes })
        .eq('booking_id', id);
      if (error) throw error;

      // Delete equipment and vehicle assignments
      await supabase.from('booking_equipment').delete().eq('booking_id', id);
      await supabase.from('vehicle_assign').delete().eq('booking_id', id);

      if (showRejectionRefund && enteredAmount > 0) {
        const { error: refundError } = await supabase
          .from('payment')
          .insert([{
            booking_id: id,
            amount_paid: -enteredAmount,
            pay_method: 'Refund',
            pay_status: 'Refunded',
            pay_datetime: new Date().toISOString(),
            pay_proof: proofUrl,
            customer_id: b.customer_id,
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

      toast.success('Booking rejected.');
      fetchData();
    } catch (error) {
      console.error(error);
      toast.error('Failed to reject booking.');
    }
  };

  return {
    isRejectionModalOpen,
    setIsRejectionModalOpen,
    rejectionBookingId,
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
  };
}
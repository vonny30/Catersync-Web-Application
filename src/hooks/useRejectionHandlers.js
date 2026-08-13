// src/hooks/useRejectionHandlers.js
import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';

export function useRejectionHandlers({ getBooking, getPaymentSummary, fetchData }) {
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
    const booking = getBooking(id);
    if (!booking) {
      toast.error('Booking not found.');
      return;
    }

    const { positivePayments = 0, downpaymentPaid = 0 } = getPaymentSummary(id) || {};
    const totalAmount = booking.total_amount || 0;
    const percentage = totalAmount > 0 ? (positivePayments / totalAmount) * 100 : 0;

    let warningMessage = `Are you sure you want to reject this booking? This will cancel it and cannot be undone.`;
    if (positivePayments > 0) {
      warningMessage = `This booking has payments totaling ₱${positivePayments.toLocaleString()} (${percentage.toFixed(1)}% of total). Rejecting this booking will keep the payments recorded. You may need to process refunds separately. Do you still want to reject?`;
    }

    const confirmed = await showConfirm({
      title: 'Reject Booking?',
      message: warningMessage,
      confirmLabel: 'Yes, Continue',
      cancelLabel: 'Cancel',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    // Calculate refund eligibility
    const eventDate = booking.event_datetime ? new Date(booking.event_datetime) : null;
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
      maxRefundable = Math.max(0, positivePayments - downpaymentPaid);
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
    const booking = getBooking(id);
    if (!booking) return;

    // --- ✅ VALIDATE: Rejection reason is required ---
    if (!rejectionReason || rejectionReason.trim() === '') {
      toast.error('Please provide a reason for rejection.');
      return;
    }

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
        const file = rejectionRefundFile;
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
          toast.error(msg);
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
      const reasonText = rejectionReason.trim();
      let updatedNotes = booking.notes
        ? `${booking.notes}\n[REJECTION] ${reasonText}`
        : `[REJECTION] ${reasonText}`;

      const { error } = await supabase
        .from('booking')
        .update({
          booking_status: 'Rejected',
          notes: updatedNotes,
        })
        .eq('booking_id', id);
      if (error) throw error;

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
            customer_id: booking.customer_id,
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
      if (fetchData) fetchData();
    } catch (error) {
      console.error('Rejection error:', error);
      toast.error('Failed to reject booking.');
    }
  };

  return {
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
  };
}
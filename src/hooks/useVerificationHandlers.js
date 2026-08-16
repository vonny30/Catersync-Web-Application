// src/hooks/useVerificationHandlers.js
//
// Manager-side review of a customer-submitted payment (Updated Flow: the
// customer pays and uploads proof, the payment lands as "Pending
// Verification", and the manager verifies or rejects it here).
import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { sumVerifiedPositivePayments } from '../utils/payments';

export function useVerificationHandlers({ payments, totalAmount, fetchData }) {
  const { showConfirm } = useConfirm();
  const [isRejectProofModalOpen, setIsRejectProofModalOpen] = useState(false);
  const [rejectProofTarget, setRejectProofTarget] = useState(null);
  const [rejectProofReason, setRejectProofReason] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  // Verifying auto-detects Downpayment vs Fully Paid the same way a
  // manager-entered payment would: if this amount closes out the balance
  // (based on already-verified payments, not counting this one), it's
  // Fully Paid; otherwise it's a Downpayment.
  const handleVerifyPayment = async (payment) => {
    const alreadyVerified = sumVerifiedPositivePayments(
      payments.filter(p => p.payment_id !== payment.payment_id)
    );
    const remainingBeforeThis = Math.max(0, (totalAmount || 0) - alreadyVerified);
    const finalStatus = payment.amount_paid >= remainingBeforeThis ? 'Fully Paid' : 'Downpayment';

    const confirmed = await showConfirm({
      title: 'Verify Payment?',
      message: `Confirm this payment of ₱${(payment.amount_paid || 0).toLocaleString()} is legitimate? It will be marked as "${finalStatus}" and the customer will see the updated status.`,
      confirmLabel: 'Yes, Verify',
      cancelLabel: 'Cancel',
      confirmVariant: 'success',
    });
    if (!confirmed) return;

    setIsVerifying(true);
    try {
      const { error } = await supabase
        .from('payment')
        .update({ pay_status: finalStatus })
        .eq('payment_id', payment.payment_id);
      if (error) throw error;
      toast.success(`Payment verified and marked as ${finalStatus}.`);
      fetchData();
    } catch (error) {
      console.error(error);
      toast.error('Failed to verify payment.');
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
        .update({
          pay_status: 'Proof Rejected',
          remarks: rejectProofReason.trim(),
        })
        .eq('payment_id', rejectProofTarget.payment_id);
      if (error) throw error;
      setIsRejectProofModalOpen(false);
      toast.success('Payment proof rejected. The customer will need to resubmit.');
      fetchData();
    } catch (error) {
      console.error(error);
      toast.error('Failed to reject payment proof.');
    } finally {
      setIsVerifying(false);
    }
  };

  return {
    isRejectProofModalOpen,
    setIsRejectProofModalOpen,
    rejectProofTarget,
    rejectProofReason,
    setRejectProofReason,
    isVerifying,
    handleVerifyPayment,
    openRejectProofModal,
    handleRejectProofConfirm,
  };
}

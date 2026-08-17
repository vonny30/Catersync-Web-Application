// src/hooks/useVerificationHandlers.js
//
// Manager-side review of a customer-submitted payment (Updated Flow: the
// customer pays and uploads proof, the payment lands as "Pending
// Verification", and the manager verifies or rejects it here).
import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { sumVerifiedPositivePayments } from '../utils/payments';

const KNOWN_METHODS = ['Cash', 'GCash', 'Bank Transfer'];

export function useVerificationHandlers({ payments, totalAmount, fetchData }) {
  const [isRejectProofModalOpen, setIsRejectProofModalOpen] = useState(false);
  const [rejectProofTarget, setRejectProofTarget] = useState(null);
  const [rejectProofReason, setRejectProofReason] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  // --- Verify modal (Confirm + choose the actual method) ---
  // Mobile submissions always come in as some form of direct transfer — the
  // customer never picks Cash there — but the app just labels it generically
  // rather than distinguishing GCash from Bank Transfer. Verifying is the
  // point a manager actually looks at the proof, so it's also the right
  // moment to record which one it really was, keeping pay_method consistent
  // with the same three options used everywhere else a payment is recorded.
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState(null);
  const [verifyMethod, setVerifyMethod] = useState('GCash');

  const openVerifyModal = (payment) => {
    setVerifyTarget(payment);
    setVerifyMethod(KNOWN_METHODS.includes(payment.pay_method) ? payment.pay_method : 'GCash');
    setIsVerifyModalOpen(true);
  };

  // Auto-detects Downpayment vs Fully Paid the same way a manager-entered
  // payment would: if this amount closes out the balance (based on already-
  // verified payments, not counting this one), it's Fully Paid; otherwise
  // it's a Downpayment.
  const handleVerifyConfirm = async () => {
    if (!verifyTarget) return;
    const payment = verifyTarget;
    const alreadyVerified = sumVerifiedPositivePayments(
      payments.filter(p => p.payment_id !== payment.payment_id)
    );
    const remainingBeforeThis = Math.max(0, (totalAmount || 0) - alreadyVerified);
    const finalStatus = payment.amount_paid >= remainingBeforeThis ? 'Fully Paid' : 'Downpayment';

    setIsVerifying(true);
    try {
      const { error } = await supabase
        .from('payment')
        .update({ pay_status: finalStatus, pay_method: verifyMethod })
        .eq('payment_id', payment.payment_id);
      if (error) throw error;
      setIsVerifyModalOpen(false);
      toast.success(`Payment verified as ${verifyMethod} and marked "${finalStatus}".`);
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
    isVerifyModalOpen,
    setIsVerifyModalOpen,
    verifyTarget,
    verifyMethod,
    setVerifyMethod,
    openVerifyModal,
    handleVerifyConfirm,
    openRejectProofModal,
    handleRejectProofConfirm,
  };
}

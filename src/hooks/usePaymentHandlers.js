import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { sumVerifiedPositivePayments, getPaymentsAwaitingVerification } from '../utils/payments';

export function usePaymentHandlers({ bookingId, payments, totalAmount, fetchData, customerId }) {
  // Modal state
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
  // Field-level errors — lets the modal highlight exactly which input is
  // blocking submission (e.g. the amount field, in red) instead of the
  // manager having to re-read a toast to figure out what to fix.
  const [paymentAmountError, setPaymentAmountError] = useState('');
  const [paymentFileError, setPaymentFileError] = useState('');

  // Helper: get proof URL
  const getProofUrl = (proofUrl) => {
    if (!proofUrl || proofUrl === 'placeholder.png' || proofUrl === 'refund_placeholder.png') return null;
    if (proofUrl.startsWith('payments/')) {
      const { data } = supabase.storage.from('images').getPublicUrl(proofUrl);
      return data.publicUrl;
    }
    if (proofUrl.startsWith('http://') || proofUrl.startsWith('https://')) return proofUrl;
    if (!proofUrl.includes('/')) {
      const { data } = supabase.storage.from('images').getPublicUrl(`payments/${proofUrl}`);
      return data.publicUrl;
    }
    return proofUrl;
  };

  // --- Record Payment ---
  const openPaymentModal = () => {
    setPaymentFormData({
      amount: '',
      pay_method: 'Cash',
      pay_status: 'Downpayment',
      pay_proof: 'placeholder.png',
    });
    setSelectedFile(null);
    setPaymentAmountError('');
    setPaymentFileError('');
    setIsPaymentModalOpen(true);
  };

  const handlePaymentInputChange = (e) => {
    const { name, value } = e.target;
    setPaymentFormData(prev => ({ ...prev, [name]: value }));
    if (name === 'amount') setPaymentAmountError('');
  };

  const handlePaymentFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setPaymentFileError('');
    }
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    setIsPaymentSubmitting(true);
    setPaymentAmountError('');
    setPaymentFileError('');

    const amount = parseFloat(paymentFormData.amount) || 0;
    if (amount <= 0) {
      toast.error('Amount must be greater than zero.');
      setPaymentAmountError('Amount must be greater than zero.');
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

    const positivePayments = sumVerifiedPositivePayments(payments);
    const remainingBalance = Math.max(0, totalAmount - positivePayments);
    const isFirstPayment = positivePayments === 0;

    // Verification comes first. A proof awaiting review may be for the very
    // money about to be entered by hand, and verifying it afterwards would
    // count the same payment twice with nothing to flag it.
    const awaitingVerification = getPaymentsAwaitingVerification(payments);
    if (awaitingVerification.length > 0) {
      const total = awaitingVerification.reduce((sum, p) => sum + (p.amount_paid || 0), 0);
      toast.error(
        awaitingVerification.length === 1
          ? `There is a ₱${total.toLocaleString()} payment awaiting verification on this booking. Verify or reject it first — recording another payment now could count the same money twice.`
          : `There are ${awaitingVerification.length} payments (₱${total.toLocaleString()}) awaiting verification on this booking. Verify or reject them first — recording another payment now could count the same money twice.`,
        { duration: 8000 }
      );
      setIsPaymentSubmitting(false);
      return;
    }


    if (remainingBalance <= 0) {
      toast.error('This booking is already fully paid. No additional payments are allowed.');
      setIsPaymentSubmitting(false);
      return;
    }
    if (amount > remainingBalance) {
      const msg = `Amount exceeds remaining balance of ₱${remainingBalance.toLocaleString()}.`;
      toast.error(msg);
      setPaymentAmountError(msg);
      setIsPaymentSubmitting(false);
      return;
    }

    // --- FILE VALIDATION (NEW) ---
    if (!selectedFile && (paymentFormData.pay_proof === 'placeholder.png' || !paymentFormData.pay_proof)) {
      toast.error('Please upload a proof of payment image.');
      setPaymentFileError('Proof of payment is required.');
      setIsPaymentSubmitting(false);
      return;
    }

    if (selectedFile) {
      const file = selectedFile;
      const maxSize = 5 * 1024 * 1024; // 5 MB
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

      if (!allowedTypes.includes(file.type)) {
        const msg = 'Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.';
        toast.error(msg);
        setPaymentFileError(msg);
        setIsPaymentSubmitting(false);
        return;
      }
      if (file.size > maxSize) {
        const msg = `File is too large. Maximum size is 5 MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)} MB.`;
        toast.error(msg);
        setPaymentFileError(msg);
        setIsPaymentSubmitting(false);
        return;
      }
    }

    const status = paymentFormData.pay_status;
    if (status === 'Downpayment' && isFirstPayment) {
      const requiredMin = totalAmount * 0.5;
      if (amount < requiredMin) {
        const msg = `First payment (Downpayment) must be at least 50% of total (₱${requiredMin.toLocaleString()}).`;
        toast.error(msg);
        setPaymentAmountError(msg);
        setIsPaymentSubmitting(false);
        return;
      }
    } else if (status === 'Fully Paid') {
      if (isFirstPayment) {
        if (amount < totalAmount) {
          const msg = `First payment marked as Fully Paid must equal the full total amount (₱${totalAmount.toLocaleString()}).`;
          toast.error(msg);
          setPaymentAmountError(msg);
          setIsPaymentSubmitting(false);
          return;
        }
      } else {
        if (amount < remainingBalance) {
          const msg = `To mark as Fully Paid, the amount must equal the remaining balance of ₱${remainingBalance.toLocaleString()}.`;
          toast.error(msg);
          setPaymentAmountError(msg);
          setIsPaymentSubmitting(false);
          return;
        }
      }
    }

    let finalPayStatus = status;
    const isAmountEqualRemaining = Math.abs(amount - remainingBalance) < 0.01;
    const isAmountEqualTotal = Math.abs(amount - totalAmount) < 0.01;

    // An amount that fully covers the balance IS a full payment, regardless
    // of which status the manager had selected in the form — asking
    // "are you sure?" here only invites a wrong answer that leaves the
    // ledger saying "Downpayment" on a booking that's actually paid off.
    // Auto-correct it and tell the manager why, instead of asking.
    let autoMarkedFullyPaid = false;
    if (status === 'Downpayment' && isFirstPayment && isAmountEqualTotal) {
      finalPayStatus = 'Fully Paid';
      autoMarkedFullyPaid = true;
    } else if (status === 'Downpayment' && !isFirstPayment && isAmountEqualRemaining) {
      finalPayStatus = 'Fully Paid';
      autoMarkedFullyPaid = true;
    }

    try {
      let proofUrl = 'placeholder.png';
      if (selectedFile) {
        setUploading(true);
        const file = selectedFile;
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `payments/${fileName}`;
        const { error: uploadError } = await supabase.storage
          .from('images')
          .upload(filePath, file);

        if (uploadError) {
          let msg = 'Failed to upload proof image.';
          if (uploadError.message?.includes('bucket not found')) {
            msg = 'Storage bucket is not configured. Please contact support.';
          } else if (uploadError.message?.includes('permission')) {
            msg = 'Permission denied. Please check your storage policies.';
          } else if (uploadError.message?.includes('too large')) {
            msg = 'File exceeds the storage limit. Please compress your image.';
          } else if (uploadError.message?.includes('duplicate')) {
            msg = 'A file with this name already exists. Please rename and try again.';
          }
          throw new Error(msg);
        }

        const { data: publicUrlData } = supabase.storage
          .from('images')
          .getPublicUrl(filePath);
        proofUrl = publicUrlData.publicUrl;
        setUploading(false);
      }

      const payload = {
        booking_id: bookingId,
        amount_paid: amount,
        pay_method: paymentFormData.pay_method,
        pay_status: finalPayStatus,
        pay_datetime: new Date().toISOString(),
        pay_proof: proofUrl,
        customer_id: customerId || null,
      };

      const { error } = await supabase.from('payment').insert([payload]);
      if (error) throw error;

      setIsPaymentModalOpen(false);
      fetchData();
      toast.success(
        autoMarkedFullyPaid
          ? `Payment recorded and marked as Fully Paid — the amount entered covers the full ${isFirstPayment ? 'total' : 'remaining'} balance.`
          : finalPayStatus === 'Fully Paid'
          ? 'Payment recorded and marked as Fully Paid.'
          : 'Payment recorded.'
      );
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to record payment.');
    } finally {
      setIsPaymentSubmitting(false);
      setUploading(false);
    }
  };

  // Payments can never be edited or deleted (per panel review): once
  // recorded, a payment has already gone through manual entry or mobile
  // proof verification, so altering or removing it afterward doesn't make
  // sense — a refund is its own new entry instead.

  return {
    // State
    isPaymentModalOpen,
    setIsPaymentModalOpen,
    paymentFormData,
    selectedFile,
    isPaymentSubmitting,
    uploading,
    paymentAmountError,
    paymentFileError,

    // Actions
    openPaymentModal,
    handlePaymentInputChange,
    handlePaymentFileChange,
    handlePaymentSubmit,

    // Expose setPaymentFormData so method buttons work
    setPaymentFormData,

    // Helper
    getProofUrl,
  };
}
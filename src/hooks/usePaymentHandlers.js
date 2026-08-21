import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePasswordConfirm } from '../contexts/PasswordConfirmContext';
import { sumVerifiedPositivePayments, isPaymentLedgerLocked, paymentLockedMessage } from '../utils/payments';

export function usePaymentHandlers({ bookingId, payments, totalAmount, fetchData, customerId, bookingStatus }) {
  const { showConfirm } = useConfirm();
  const { requestPasswordConfirm } = usePasswordConfirm();

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

  // Edit payment modal
  const [isEditPaymentModalOpen, setIsEditPaymentModalOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState(null);
  const [editPaymentFormData, setEditPaymentFormData] = useState({
    amount: '',
    pay_method: 'Cash',
    pay_status: 'Downpayment',
    pay_proof: 'placeholder.png',
  });
  const [editSelectedFile, setEditSelectedFile] = useState(null);
  const [editAmountError, setEditAmountError] = useState('');
  const [editFileError, setEditFileError] = useState('');

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

    const positivePayments = sumVerifiedPositivePayments(
      payments.filter(p => (editingPayment ? p.payment_id !== editingPayment.payment_id : true))
    );
    const remainingBalance = Math.max(0, totalAmount - positivePayments);
    const isFirstPayment = positivePayments === 0;

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

  // --- Edit Payment ---
  const openEditPaymentModal = (payment) => {
    if (isPaymentLedgerLocked(bookingStatus)) {
      toast.error(paymentLockedMessage(bookingStatus));
      return;
    }
    setEditingPayment(payment);
    setEditPaymentFormData({
      amount: payment.amount_paid?.toString() || '',
      pay_method: payment.pay_method || 'Cash',
      pay_status: payment.pay_status || 'Downpayment',
      pay_proof: payment.pay_proof || 'placeholder.png',
    });
    setEditSelectedFile(null);
    setEditAmountError('');
    setEditFileError('');
    setIsEditPaymentModalOpen(true);
  };

  const handleEditPaymentSubmit = async (e) => {
    e.preventDefault();
    setIsPaymentSubmitting(true);
    setEditAmountError('');
    setEditFileError('');

    if (isPaymentLedgerLocked(bookingStatus)) {
      toast.error(paymentLockedMessage(bookingStatus));
      setIsPaymentSubmitting(false);
      return;
    }

    const amount = parseFloat(editPaymentFormData.amount) || 0;
    if (amount <= 0) {
      toast.error('Amount must be greater than zero.');
      setEditAmountError('Amount must be greater than zero.');
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

    // --- FILE VALIDATION FOR EDIT (NEW) ---
    // If a new file is selected, validate it; otherwise, keep existing proof
    if (editSelectedFile) {
      const file = editSelectedFile;
      const maxSize = 5 * 1024 * 1024;
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

      if (!allowedTypes.includes(file.type)) {
        const msg = 'Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.';
        toast.error(msg);
        setEditFileError(msg);
        setIsPaymentSubmitting(false);
        return;
      }
      if (file.size > maxSize) {
        const msg = `File is too large. Maximum size is 5 MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)} MB.`;
        toast.error(msg);
        setEditFileError(msg);
        setIsPaymentSubmitting(false);
        return;
      }
    } else if (!editPaymentFormData.pay_proof || editPaymentFormData.pay_proof === 'placeholder.png') {
      // If no new file and existing proof is missing or placeholder, require upload
      toast.error('Please upload a proof of payment image.');
      setEditFileError('Proof of payment is required.');
      setIsPaymentSubmitting(false);
      return;
    }

    // Check if editing would exceed remaining balance
    const positivePayments = sumVerifiedPositivePayments(
      payments.filter(p => p.payment_id !== editingPayment.payment_id)
    );
    const newRemainingBalance = Math.max(0, totalAmount - positivePayments - amount);
    if (newRemainingBalance < 0) {
      const msg = `Amount exceeds remaining balance of ₱${(totalAmount - positivePayments).toLocaleString()}.`;
      toast.error(msg);
      setEditAmountError(msg);
      setIsPaymentSubmitting(false);
      return;
    }

    const totalPaid = positivePayments;
    const isFirstPayment = totalPaid === 0;

    if (isFirstPayment && editPaymentFormData.pay_status === 'Downpayment' && amount < totalAmount * 0.5) {
      const msg = `First payment must be at least 50% of total (₱${(totalAmount * 0.5).toLocaleString()}).`;
      toast.error(msg);
      setEditAmountError(msg);
      setIsPaymentSubmitting(false);
      return;
    }

    // A payment can't stay labeled "Fully Paid" if, after this edit, the
    // booking's total paid no longer actually covers the total amount —
    // otherwise reducing the amount on a Fully Paid row silently leaves
    // it saying Fully Paid while a real balance remains.
    if (editPaymentFormData.pay_status === 'Fully Paid' && newRemainingBalance > 0) {
      const msg = `This amount leaves a remaining balance of ₱${newRemainingBalance.toLocaleString()}, so it can't stay marked "Fully Paid." Either keep the amount at ₱${(totalAmount - positivePayments).toLocaleString()}, or change the status to Downpayment.`;
      toast.error(msg);
      setEditAmountError(msg);
      setIsPaymentSubmitting(false);
      return;
    }

    try {
      let proofUrl = editPaymentFormData.pay_proof;
      if (editSelectedFile) {
        setUploading(true);
        const file = editSelectedFile;
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
      fetchData();
      toast.success('Payment saved.');
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to update payment.');
    } finally {
      setIsPaymentSubmitting(false);
      setUploading(false);
    }
  };

  const handleDeletePayment = async (paymentId) => {
    if (isPaymentLedgerLocked(bookingStatus)) {
      toast.error(paymentLockedMessage(bookingStatus));
      return;
    }

    const confirmed = await showConfirm({
      title: 'Delete Payment?',
      message: 'This will permanently delete this payment record. This action cannot be undone.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: 'Deleting this payment record is permanent. Re-enter your password to continue.',
    });
    if (!passwordOk) return;

    try {
      const { error } = await supabase
        .from('payment')
        .delete()
        .eq('payment_id', paymentId);
      if (error) throw error;
      toast.success('Payment deleted.');
      fetchData();
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete payment.');
    }
  };

  return {
    // State
    isPaymentModalOpen,
    setIsPaymentModalOpen,
    isEditPaymentModalOpen,
    setIsEditPaymentModalOpen,
    editingPayment,
    paymentFormData,
    editPaymentFormData,
    selectedFile,
    editSelectedFile,
    isPaymentSubmitting,
    uploading,
    paymentAmountError,
    paymentFileError,
    editAmountError,
    editFileError,

    // Actions
    openPaymentModal,
    handlePaymentInputChange,
    handlePaymentFileChange,
    handlePaymentSubmit,
    openEditPaymentModal,
    handleEditPaymentSubmit,
    handleDeletePayment,
    setEditPaymentFormData,
    setEditSelectedFile,

    // Expose setPaymentFormData so method buttons work
    setPaymentFormData,

    // Helper
    getProofUrl,
  };
}
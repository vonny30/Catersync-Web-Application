import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';

export function usePaymentHandlers({ bookingId, payments, totalAmount, fetchData, customerId }) {
  const { showConfirm } = useConfirm();

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

    const amount = parseFloat(paymentFormData.amount) || 0;
    if (amount <= 0) {
      toast.error('Amount must be greater than zero.');
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

    const positivePayments = payments
      .filter(p => p.amount_paid > 0 && (editingPayment ? p.payment_id !== editingPayment.payment_id : true))
      .reduce((sum, p) => sum + p.amount_paid, 0);
    const remainingBalance = Math.max(0, totalAmount - positivePayments);
    const isFirstPayment = positivePayments === 0;

    if (remainingBalance <= 0) {
      toast.error('This booking is already fully paid. No additional payments are allowed.');
      setIsPaymentSubmitting(false);
      return;
    }
    if (amount > remainingBalance) {
      toast.error(`Amount exceeds remaining balance of ₱${remainingBalance.toLocaleString()}.`);
      setIsPaymentSubmitting(false);
      return;
    }

    // --- FILE VALIDATION (NEW) ---
    if (!selectedFile && (paymentFormData.pay_proof === 'placeholder.png' || !paymentFormData.pay_proof)) {
      toast.error('Please upload a proof of payment image.');
      setIsPaymentSubmitting(false);
      return;
    }

    if (selectedFile) {
      const file = selectedFile;
      const maxSize = 5 * 1024 * 1024; // 5 MB
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

      if (!allowedTypes.includes(file.type)) {
        toast.error('Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.');
        setIsPaymentSubmitting(false);
        return;
      }
      if (file.size > maxSize) {
        toast.error(`File is too large. Maximum size is 5 MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)} MB.`);
        setIsPaymentSubmitting(false);
        return;
      }
    }

    const status = paymentFormData.pay_status;
    if (status === 'Downpayment' && isFirstPayment) {
      const requiredMin = totalAmount * 0.5;
      if (amount < requiredMin) {
        toast.error(`First payment (Downpayment) must be at least 50% of total (₱${requiredMin.toLocaleString()}).`);
        setIsPaymentSubmitting(false);
        return;
      }
    } else if (status === 'Fully Paid') {
      if (isFirstPayment) {
        if (amount < totalAmount) {
          toast.error(`First payment marked as Fully Paid must equal the full total amount (₱${totalAmount.toLocaleString()}).`);
          setIsPaymentSubmitting(false);
          return;
        }
      } else {
        if (amount < remainingBalance) {
          toast.error(`To mark as Fully Paid, the amount must equal the remaining balance of ₱${remainingBalance.toLocaleString()}.`);
          setIsPaymentSubmitting(false);
          return;
        }
      }
    }

    let finalPayStatus = status;
    const isAmountEqualRemaining = Math.abs(amount - remainingBalance) < 0.01;
    const isAmountEqualTotal = Math.abs(amount - totalAmount) < 0.01;

    if (status === 'Downpayment' && isFirstPayment && isAmountEqualTotal) {
      const confirm = await showConfirm({
        title: 'Full Payment?',
        message: `This is the first payment and the amount (₱${amount.toLocaleString()}) equals the full total. Would you like to mark it as Fully Paid instead?`,
        confirmLabel: 'Yes, Mark Fully Paid',
        cancelLabel: 'No, Keep as Downpayment',
        confirmVariant: 'success',
      });
      if (confirm) {
        finalPayStatus = 'Fully Paid';
        setPaymentFormData(prev => ({ ...prev, pay_status: 'Fully Paid' }));
      }
    }

    if (status === 'Downpayment' && isAmountEqualRemaining && !isFirstPayment) {
      const confirm = await showConfirm({
        title: 'Full Payment?',
        message: `This payment amount (₱${amount.toLocaleString()}) equals the remaining balance. Would you like to mark it as Fully Paid instead?`,
        confirmLabel: 'Yes, Mark Fully Paid',
        cancelLabel: 'No, Keep as Downpayment',
        confirmVariant: 'success',
      });
      if (confirm) {
        finalPayStatus = 'Fully Paid';
        setPaymentFormData(prev => ({ ...prev, pay_status: 'Fully Paid' }));
      }
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
      toast.success(finalPayStatus === 'Fully Paid' ? 'Payment recorded and marked as Fully Paid!' : 'Payment recorded successfully!');
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
    setEditingPayment(payment);
    setEditPaymentFormData({
      amount: payment.amount_paid?.toString() || '',
      pay_method: payment.pay_method || 'Cash',
      pay_status: payment.pay_status || 'Downpayment',
      pay_proof: payment.pay_proof || 'placeholder.png',
    });
    setEditSelectedFile(null);
    setIsEditPaymentModalOpen(true);
  };

  const handleEditPaymentSubmit = async (e) => {
    e.preventDefault();
    setIsPaymentSubmitting(true);
    const amount = parseFloat(editPaymentFormData.amount) || 0;
    if (amount <= 0) {
      toast.error('Amount must be greater than zero.');
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
        toast.error('Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.');
        setIsPaymentSubmitting(false);
        return;
      }
      if (file.size > maxSize) {
        toast.error(`File is too large. Maximum size is 5 MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)} MB.`);
        setIsPaymentSubmitting(false);
        return;
      }
    } else if (!editPaymentFormData.pay_proof || editPaymentFormData.pay_proof === 'placeholder.png') {
      // If no new file and existing proof is missing or placeholder, require upload
      toast.error('Please upload a proof of payment image.');
      setIsPaymentSubmitting(false);
      return;
    }

    // Check if editing would exceed remaining balance
    const positivePayments = payments
      .filter(p => p.amount_paid > 0 && p.payment_id !== editingPayment.payment_id)
      .reduce((sum, p) => sum + p.amount_paid, 0);
    const newRemainingBalance = Math.max(0, totalAmount - positivePayments - amount);
    if (newRemainingBalance < 0) {
      toast.error(`Amount exceeds remaining balance of ₱${(totalAmount - positivePayments).toLocaleString()}.`);
      setIsPaymentSubmitting(false);
      return;
    }

    const existingPayments = payments.filter(p => p.booking_id === bookingId && p.amount_paid > 0 && p.payment_id !== editingPayment.payment_id);
    const totalPaid = existingPayments.reduce((sum, p) => sum + p.amount_paid, 0);
    const isFirstPayment = totalPaid === 0;

    if (isFirstPayment && editPaymentFormData.pay_status === 'Downpayment' && amount < totalAmount * 0.5) {
      toast.error(`First payment must be at least 50% of total (₱${(totalAmount * 0.5).toLocaleString()}).`);
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
      toast.success('Payment updated successfully.');
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to update payment.');
    } finally {
      setIsPaymentSubmitting(false);
      setUploading(false);
    }
  };

  const handleDeletePayment = async (paymentId) => {
    const confirmed = await showConfirm({
      title: 'Delete Payment?',
      message: 'This will permanently delete this payment record. This action cannot be undone.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

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
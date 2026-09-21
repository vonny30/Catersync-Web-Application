import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import {
  sumVerifiedPositivePayments, getPaymentsAwaitingVerification, validateReceipt,
  methodNeedsReceiptNumber, ENTRY_TYPES,
} from '../utils/payments';

export function usePaymentHandlers({ bookingId, payments, totalAmount, fetchData, customerId }) {
  // Modal state
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  // No pay_status here: the stage is chosen by the system from the money
  // already in (validateReceipt -> stageForReceipt), never by the manager.
  const EMPTY_RECEIPT = { amount: '', pay_method: 'Cash', receipt_reference: '' };
  const [paymentFormData, setPaymentFormData] = useState(EMPTY_RECEIPT);
  // Field-level errors — lets the modal highlight exactly which input is
  // blocking submission (e.g. the amount field, in red) instead of the
  // manager having to re-read a toast to figure out what to fix.
  const [paymentAmountError, setPaymentAmountError] = useState('');
  const [paymentFileError, setPaymentFileError] = useState('');
  const [paymentReceiptError, setPaymentReceiptError] = useState('');

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
    // Anything that reached here is not a storage key and not a URL, so it
    // cannot be resolved to an image. Returning it handed the raw value
    // straight to <img src>, which is how 14 seeded 'seed://...' values
    // became broken images behind a clickable thumbnail. null routes them to
    // renderProof's "Invalid" branch instead, which says the record is broken
    // rather than pretending no proof was ever uploaded.
    //
    // NOTE: this function is duplicated in pages/Receivables.jsx (the Receivables
    // page has its own copy and does not import this hook). Fix both.
    return null;
  };

  // --- Record Payment ---
  const openPaymentModal = () => {
    setPaymentFormData(EMPTY_RECEIPT);
    setSelectedFile(null);
    setPaymentAmountError('');
    setPaymentFileError('');
    setPaymentReceiptError('');
    setIsPaymentModalOpen(true);
  };

  const handlePaymentInputChange = (e) => {
    const { name, value } = e.target;
    setPaymentFormData(prev => ({ ...prev, [name]: value }));
    if (name === 'amount') setPaymentAmountError('');
    if (name === 'receipt_reference') setPaymentReceiptError('');
  };

  // Switching away from Cash clears the receipt number, so a number typed for
  // a cash receipt is never saved against a GCash one. (An image stays: it is
  // optional for cash and required for the others, so it is never stale.)
  const handlePaymentMethodChange = (method) => {
    setPaymentFormData(prev => ({
      ...prev,
      pay_method: method,
      receipt_reference: methodNeedsReceiptNumber(method) ? prev.receipt_reference : '',
    }));
    setPaymentReceiptError('');
    setPaymentFileError('');
  };

  // What the money already in says about this booking, for the form's hints and
  // stage preview. Counted receipts only (see movesBooks).
  const priorPaid = sumVerifiedPositivePayments(payments);

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
    setPaymentReceiptError('');

    const amount = parseFloat(paymentFormData.amount) || 0;

    // Verification comes first. A proof awaiting review may be for the very
    // money about to be entered by hand, and verifying it afterwards would
    // count the same payment twice with nothing to flag it.
    const awaitingVerification = getPaymentsAwaitingVerification(payments);
    if (awaitingVerification.length > 0) {
      const total = awaitingVerification.reduce((sum, p) => sum + (p.amount_paid || 0), 0);
      toast.error(
        awaitingVerification.length === 1
          ? `There is a ₱${total.toLocaleString()} payment claim awaiting verification on this booking. Verify or reject it first — recording a receipt now could count the same money twice.`
          : `There are ${awaitingVerification.length} payment claims (₱${total.toLocaleString()}) awaiting verification on this booking. Verify or reject them first — recording a receipt now could count the same money twice.`,
        { duration: 8000 }
      );
      setIsPaymentSubmitting(false);
      return;
    }

    const check = validateReceipt({
      amount,
      method: paymentFormData.pay_method,
      receiptReference: paymentFormData.receipt_reference,
      hasImage: !!selectedFile,
      priorPaid,
      total: totalAmount,
    });
    if (!check.ok) {
      toast.error(check.message);
      if (check.field === 'amount') setPaymentAmountError(check.message);
      if (check.field === 'receipt') setPaymentReceiptError(check.message);
      if (check.field === 'file') setPaymentFileError(check.message);
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

    const stage = check.stage;

    try {
      // null, not a placeholder: payment_evidence_check needs a receipt to carry
      // real evidence — an image, or (cash) the receipt number.
      let proofUrl = null;
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
        pay_status: stage,
        entry_type: ENTRY_TYPES.receipt,
        receipt_reference: methodNeedsReceiptNumber(paymentFormData.pay_method)
          ? paymentFormData.receipt_reference.trim()
          : null,
        pay_datetime: new Date().toISOString(),
        pay_proof: proofUrl,
        customer_id: customerId || null,
      };

      const { error } = await supabase.from('payment').insert([payload]);
      if (error) throw error;

      setIsPaymentModalOpen(false);
      fetchData();
      toast.success(`Receipt recorded as ${stage}.`);
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to record payment.');
    } finally {
      setIsPaymentSubmitting(false);
      setUploading(false);
    }
  };

  // Receipts are never edited or deleted. A wrong one is corrected by a
  // reversing entry (Receivables page), a returned one by a refund; both are
  // new rows, and the original stays on record.

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
    paymentReceiptError,
    priorPaid,

    // Actions
    openPaymentModal,
    handlePaymentInputChange,
    handlePaymentFileChange,
    handlePaymentMethodChange,
    handlePaymentSubmit,

    // Expose setPaymentFormData so method buttons work
    setPaymentFormData,

    // Helper
    getProofUrl,
  };
}
// src/utils/refundEvidence.js
//
// The evidence a refund carries, decided by how the money went back — the same
// rule receipts already follow (methodNeedsReceiptNumber in utils/payments):
//
//   Cash                  the number on the paper receipt given to the
//                         customer. Required. An image is optional.
//   GCash, Bank Transfer  a screenshot of the transfer. Required.
//
// Every refund flow — cancelling, rejecting, and adding a refund to an already
// cancelled booking — used to demand a screenshot whatever the method, which
// asked a manager to photograph a cash hand-over that already has a receipt.
// The database takes either: payment_evidence_check applies to receipts only.
import { supabase } from '../supabase';
import { methodNeedsReceiptNumber } from './payments';

const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Validate and, where there is an image, upload it.
 *
 * @returns {Promise<{ error: string } | { proofUrl: string|null, receiptReference: string|null }>}
 */
export async function prepareRefundEvidence({ method, file, receiptNo }) {
  const cash = methodNeedsReceiptNumber(method);
  const number = (receiptNo || '').trim();

  if (cash && !number) return { error: 'Enter the number on the cash receipt you gave the customer.' };
  if (!cash && !file) return { error: 'Please upload a proof of refund image.' };

  let proofUrl = null;
  if (file) {
    if (!ALLOWED_PROOF_TYPES.includes(file.type)) {
      return { error: 'Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.' };
    }
    if (file.size > MAX_PROOF_BYTES) {
      return { error: `File is too large. Maximum size is 5 MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)} MB.` };
    }
    const fileExt = file.name.split('.').pop();
    const fileName = `refunds/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from('images').upload(fileName, file);
    if (uploadError) return { error: 'Failed to upload refund proof. Please try again.' };
    proofUrl = supabase.storage.from('images').getPublicUrl(fileName).data.publicUrl;
  }

  return { proofUrl, receiptReference: cash ? number : null };
}

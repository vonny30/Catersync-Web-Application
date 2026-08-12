// src/utils/createWalkInCustomer.js
import { supabase } from '../supabase';
import toast from 'react-hot-toast';

/**
 * Creates a new customer account (Auth + customer table) for walk‑in bookings.
 * Handles duplicates by email, name+phone, and restores the manager session afterwards.
 * @param {Object} walkInData - { first_name, last_name, contact_no, email_address, cus_address }
 * @returns {Promise<string>} - The new customer_id (or existing one if duplicate).
 */
export async function createWalkInCustomer(walkInData) {
  // ✅ CRITICAL: Set the global flag BEFORE calling signUp
  // This prevents AuthContext from logging out the manager
  window.isCreatingWalkIn = true;

  try {
    // Save current session to restore after auth sign-up
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (!currentSession) {
      throw new Error('You must be logged in as a manager to create walk‑in customers.');
    }

    // 1. Check duplicate by email
    const { data: existingByEmail } = await supabase
      .from('customer')
      .select('customer_id, first_name, last_name')
      .eq('email_address', walkInData.email_address)
      .maybeSingle();

    if (existingByEmail) {
      toast(`Customer already exists: ${existingByEmail.first_name} ${existingByEmail.last_name}. Reusing existing profile.`, { icon: 'ℹ️' });
      return existingByEmail.customer_id;
    }

    // 2. Check duplicate by exact name + phone
    const { data: existingByNamePhone } = await supabase
      .from('customer')
      .select('customer_id')
      .eq('first_name', walkInData.first_name)
      .eq('last_name', walkInData.last_name)
      .eq('contact_no', walkInData.contact_no)
      .maybeSingle();

    if (existingByNamePhone) {
      toast(`Customer with same name and phone already exists. Reusing existing profile.`, { icon: 'ℹ️' });
      return existingByNamePhone.customer_id;
    }

    // 3. Generate a unique username based on email prefix
    const usernameBase = walkInData.email_address.split('@')[0];
    let username = usernameBase;
    let counter = 1;
    while (true) {
      const { data: existingUser } = await supabase
        .from('customer')
        .select('customer_id')
        .eq('username', username)
        .maybeSingle();
      if (!existingUser) break;
      username = `${usernameBase}${counter}`;
      counter++;
    }

    // ✅ 4. Create Supabase Auth user with the fixed default password
    const defaultPassword = 'password123';
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: walkInData.email_address,
      password: defaultPassword,
      options: { emailRedirectTo: window.location.origin },
    });

    if (authError) {
      if (authError.message.includes('already registered')) {
        const { data: existing } = await supabase
          .from('customer')
          .select('customer_id')
          .eq('email_address', walkInData.email_address)
          .maybeSingle();
        if (existing) {
          toast('Customer already exists. Using existing account.', { icon: 'ℹ️' });
          return existing.customer_id;
        }
      }
      throw new Error(authError.message || 'Failed to create auth account.');
    }

    // 5. Insert into customer table (⚠️ NO PASSWORD COLUMN)
    const { data: newCustomer, error: customerError } = await supabase
      .from('customer')
      .insert([{
        first_name: walkInData.first_name,
        last_name: walkInData.last_name,
        contact_no: walkInData.contact_no,
        email_address: walkInData.email_address,
        cus_address: walkInData.cus_address || 'N/A',
        username: username,
        account_status: 'Active',
        user_id: authData.user?.id,
        // password column DOES NOT exist – removed per security fix
      }])
      .select()
      .single();

    if (customerError) throw customerError;

    // 6. Restore manager session (the sign-up may have switched the session)
    await new Promise(resolve => setTimeout(resolve, 300));

    if (currentSession) {
      const { error: restoreError } = await supabase.auth.setSession({
        access_token: currentSession.access_token,
        refresh_token: currentSession.refresh_token,
      });
      if (restoreError) {
        // Fallback: try refresh
        await supabase.auth.refreshSession();
      }
    }

    // 7. Notify success
    toast.success(`Customer account created! Default password: password123 (they can reset it via email)`);

    return newCustomer.customer_id;

  } catch (error) {
    console.error('Error creating walk-in customer:', error);
    throw new Error(error.message || 'Failed to create customer account. Please try again.');
  } finally {
    // ✅ CRITICAL: Always clear the flag when done
    window.isCreatingWalkIn = false;
  }
}
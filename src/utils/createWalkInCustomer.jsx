// src/utils/createWalkInCustomer.jsx
import { supabase } from '../supabase';
import toast from 'react-hot-toast';

export async function createWalkInCustomer(walkInData) {
  // Initialize counter if not exists
  if (typeof window._pendingWalkInCount === 'undefined') {
    window._pendingWalkInCount = 0;
  }

  // Increment before starting the creation
  window._pendingWalkInCount++;

  try {
    // Strict validation
    const trimmedFirstName = walkInData.first_name?.trim();
    const trimmedLastName = walkInData.last_name?.trim();
    const trimmedContact = walkInData.contact_no?.trim();
    const trimmedEmail = walkInData.email_address?.trim();
    const trimmedAddress = walkInData.cus_address?.trim();

    if (!trimmedFirstName || !trimmedLastName) {
      throw new Error('First name and last name are required.');
    }
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      throw new Error('Please enter a valid email address (e.g., user@domain.com).');
    }
    if (!trimmedContact || !/^09\d{9}$/.test(trimmedContact)) {
      throw new Error(
        'Contact number must be a valid 11‑digit Philippine mobile number starting with 09 (e.g., 09123456789).'
      );
    }

    walkInData.first_name = trimmedFirstName;
    walkInData.last_name = trimmedLastName;
    walkInData.contact_no = trimmedContact;
    walkInData.email_address = trimmedEmail;
    walkInData.cus_address = trimmedAddress || 'N/A';

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
      toast(
        `Customer already exists: ${existingByEmail.first_name} ${existingByEmail.last_name}. Reusing existing profile.`,
        { icon: 'ℹ️' }
      );
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
      toast(
        `Customer with same name and phone already exists. Reusing existing profile.`,
        { icon: 'ℹ️' }
      );
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

    // 4. Create Supabase Auth user (temporary password)
    const defaultPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
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

    // 5. Insert into customer table
    const { data: newCustomer, error: customerError } = await supabase
      .from('customer')
      .insert([
        {
          first_name: walkInData.first_name,
          last_name: walkInData.last_name,
          contact_no: walkInData.contact_no,
          email_address: walkInData.email_address,
          cus_address: walkInData.cus_address,
          username: username,
          account_status: 'Active',
          user_id: authData.user?.id,
        },
      ])
      .select()
      .single();

    if (customerError) throw customerError;

    // 6. Restore manager session
    await new Promise((resolve) => setTimeout(resolve, 300));

    if (currentSession) {
      const { error: restoreError } = await supabase.auth.setSession({
        access_token: currentSession.access_token,
        refresh_token: currentSession.refresh_token,
      });
      if (restoreError) {
        await supabase.auth.refreshSession();
      }
    }

    // ✅ CRITICAL: Wait for auth events to settle while counter is still > 0
    await new Promise((resolve) => setTimeout(resolve, 500));

    toast.success(
      `Customer account created! Temporary password: ${defaultPassword} (they can reset it via email)`
    );

    return newCustomer.customer_id;
  } catch (error) {
    console.error('Error creating walk-in customer:', error);
    throw new Error(error.message || 'Failed to create customer account. Please try again.');
  } finally {
    // Decrement counter with a tiny delay to catch any late events
    setTimeout(() => {
      if (window._pendingWalkInCount > 0) {
        window._pendingWalkInCount--;
      }
    }, 50);
  }
}
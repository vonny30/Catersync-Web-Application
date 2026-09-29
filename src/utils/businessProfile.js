// src/utils/businessProfile.js
//
// PG's Catering's own name and public contact details, kept in the one-row
// table public.business_profile and edited by the manager in
// Settings -> Business Details. Everything that shows the business's name or
// contact details reads it from here, so a change in Settings shows up
// everywhere without a code change.
//
// Readable without signing in (the Privacy Notice and Terms pages are public),
// so it is fetched once per page load and shared by every component.
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';

export const DEFAULT_BUSINESS = {
  business_name: "PG's Catering",
  email: null,
  phone: null,
  address: null,
  updated_at: null,
};

let cache = null;
let inflight = null;
const listeners = new Set();

function publish(profile) {
  cache = profile;
  listeners.forEach((listener) => listener(profile));
}

export async function loadBusinessProfile({ force = false } = {}) {
  if (cache && !force) return cache;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    const { data, error } = await supabase
      .from('business_profile')
      .select('business_name, email, phone, address, updated_at')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      console.error('Could not load the business profile:', error);
      return cache || DEFAULT_BUSINESS;
    }
    const profile = { ...DEFAULT_BUSINESS, ...(data || {}) };
    publish(profile);
    return profile;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

// Called by Settings after a successful save, so every mounted component
// updates at once.
export function setBusinessProfile(profile) {
  publish({ ...DEFAULT_BUSINESS, ...profile });
}

export function useBusinessProfile() {
  const [profile, setProfile] = useState(cache || DEFAULT_BUSINESS);
  useEffect(() => {
    listeners.add(setProfile);
    loadBusinessProfile().then(setProfile);
    return () => { listeners.delete(setProfile); };
  }, []);
  return profile;
}

// Drop-in for the business's name inside any JSX text.
export function BusinessName() {
  return useBusinessProfile().business_name;
}

// 09171234567 -> 0917 123 4567
export function formatPhone(phone) {
  if (!phone || !/^09\d{9}$/.test(phone)) return phone || '';
  return `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`;
}

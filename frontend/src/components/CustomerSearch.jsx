// src/components/CustomerSearch.jsx
import { useState, useEffect, useRef } from 'react';
import { Search, X, UserPlus } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';

export default function CustomerSearch({
  onSelectCustomer,
  onCreateNew,
  selectedCustomerId,
  selectedCustomerName,
  placeholder = 'Search customer by name, phone, or email...',
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  // Clear search when a customer is selected
  useEffect(() => {
    if (selectedCustomerId) {
      setSearchTerm('');
      setResults([]);
      setIsOpen(false);
    }
  }, [selectedCustomerId]);

  // Fetch recent customers when input is focused with empty search
  const fetchRecentCustomers = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('customer')
        .select('customer_id, first_name, last_name, contact_no, email_address')
        .eq('account_status', 'Active')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      setResults(data || []);
      setIsOpen(data && data.length > 0);
    } catch (error) {
      console.error('Failed to fetch recent customers:', error);
      setResults([]);
      setIsOpen(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Debounced search
  useEffect(() => {
    if (searchTerm.length === 0) {
      // If input is empty, show recent customers (but only if we have focus)
      if (document.activeElement === inputRef.current) {
        fetchRecentCustomers();
      } else {
        setResults([]);
        setIsOpen(false);
      }
      return;
    }

    if (searchTerm.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('customer')
          .select('customer_id, first_name, last_name, contact_no, email_address')
          .or(
            `first_name.ilike.%${searchTerm}%,` +
            `last_name.ilike.%${searchTerm}%,` +
            `contact_no.ilike.%${searchTerm}%,` +
            `email_address.ilike.%${searchTerm}%`
          )
          .eq('account_status', 'Active')
          .limit(8);

        if (error) throw error;
        setResults(data || []);
        setIsOpen(data && data.length > 0);
      } catch (error) {
        console.error('Customer search error:', error);
        toast.error('Failed to search customers. Please try again.');
        setResults([]);
        setIsOpen(false);
      } finally {
        setIsLoading(false);
      }
    }, 350);

    return () => clearTimeout(delayDebounce);
  }, [searchTerm]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (customer) => {
    onSelectCustomer(customer.customer_id, `${customer.first_name} ${customer.last_name}`);
    setSearchTerm('');
    setResults([]);
    setIsOpen(false);
  };

  const handleCreateNew = () => {
    setIsOpen(false);
    onCreateNew(searchTerm);
    setSearchTerm('');
  };

  const handleClearSelection = () => {
    onSelectCustomer(null, '');
    setSearchTerm('');
    setResults([]);
    setIsOpen(false);
    // Focus the input after clearing
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleInputFocus = () => {
    if (searchTerm.length === 0) {
      fetchRecentCustomers();
    } else if (searchTerm.length >= 2) {
      // Already searching, keep results
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      {/* Selected customer chip / input */}
      {selectedCustomerId ? (
        <div className="flex items-center justify-between bg-[#EAF3F2] border border-[#008A45] rounded-lg px-4 py-2.5">
          <span className="font-bold text-slate-900">
            {selectedCustomerName}
            <span className="ml-2 text-xs font-normal text-slate-500">(Selected)</span>
          </span>
          <button
            type="button"
            onClick={handleClearSelection}
            className="text-slate-400 hover:text-red-500 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                if (e.target.value.length >= 2) setIsOpen(true);
              }}
              onFocus={handleInputFocus}
              placeholder={placeholder}
              className="w-full border border-slate-300 rounded-lg pl-10 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
            />
            {isLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-[#008A45] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Dropdown results */}
          {isOpen && (
            <div
              className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto"
              onMouseDown={(e) => e.preventDefault()} // prevent blur when clicking inside
            >
              {results.length > 0 ? (
                results.map((customer) => (
                  <button
                    key={customer.customer_id}
                    type="button"
                    onClick={() => handleSelect(customer)}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors"
                  >
                    <div className="font-medium text-slate-900">
                      {customer.first_name} {customer.last_name}
                    </div>
                    <div className="text-xs text-slate-500 flex gap-3 mt-0.5">
                      <span>{customer.contact_no || 'No phone'}</span>
                      <span className="text-slate-300">|</span>
                      <span>{customer.email_address || 'No email'}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-3 text-center">
                  {searchTerm.length >= 2 ? (
                    <>
                      <p className="text-sm text-slate-500 mb-2">No existing customers found.</p>
                      <button
                        type="button"
                        onClick={handleCreateNew}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-[#008A45] text-white text-sm font-semibold rounded-lg hover:bg-[#007038] transition-colors"
                      >
                        <UserPlus size={16} />
                        Create New Customer
                      </button>
                    </>
                  ) : (
                    <p className="text-sm text-slate-400">Type at least 2 characters to search.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Helper text when no customer selected */}
      {!selectedCustomerId && searchTerm.length === 0 && (
        <p className="text-xs text-slate-400 mt-1">
          Type to search, or click the input to see recent customers.
        </p>
      )}
    </div>
  );
}
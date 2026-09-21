// src/utils/customerPicker.js
//
// Which customers the "Existing customer" picker on the new Booking and new
// Short Order forms lists. One rule for both forms.
//
// It used to show the first 10 customers with an empty search and at most 15
// matches while typing, so with 21 customers on record the form offered only
// half of them and read as though the rest did not exist. The list scrolls,
// so every match is shown.
export function filterCustomersForPicker(customers, search) {
  const term = (search || '').trim().toLowerCase();
  if (!term) return customers || [];
  return (customers || []).filter(c =>
    `${c.first_name} ${c.last_name}`.toLowerCase().includes(term) ||
    (c.contact_no || '').includes(term) ||
    (c.email_address || '').toLowerCase().includes(term)
  );
}

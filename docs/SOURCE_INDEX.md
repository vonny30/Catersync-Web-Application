# Source index

103 files, 41,163 lines. Every source file in `src/`, grouped by
folder, with the opening sentence of its header comment. Generated from the
files on 3 October 2026; if this list and a file ever disagree, the file is
right.

## `src/`

| File | Lines | What it is |
|---|---:|---|
| `App.jsx` | 163 | The application shell: the providers every page relies on (auth, the confirm dialog, the password-confirm dialog), the toast container, and the route table. |
| `brand.js` | 20 | The one place the logo is set. |
| `main.jsx` | 15 | Entry point. |
| `supabase.js` | 44 | The one Supabase client the whole app shares, built from the VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables. |

## `src/components/`

| File | Lines | What it is |
|---|---:|---|
| `ApprovalAvailabilityCheck.jsx` | 669 | Shown inside the Approve modal (used identically from Bookings/ShortOrders list pages and their Details pages) so a manager sees the same day-schedule and... |
| `ApprovalModal.jsx` | 172 | THE approve pop-up — Bookings, Short Orders and the Dashboard all render this one, so approving looks and behaves the same wherever it starts. |
| `AssignVehicleModal.jsx` | 566 | Assign a vehicle to a booking, from the booking's own page. |
| `BookingSheetPreview.jsx` | 70 | Shows the booking details sheet as it will be saved, then downloads it as a PDF or a PNG named Name_BookingNo — what is previewed is what is saved. |
| `BusinessProfileSettings.jsx` | 207 | Settings -> Business Details: PG's Catering's name and public contact details (public.business_profile). |
| `CollectibleBreakdown.jsx` | 79 | Where the Accounts Receivable figure comes from: every Confirmed or Completed booking with an event in the period and money still owed, one row each. |
| `ConfirmModal.jsx` | 83 | The app-wide "Are you sure?" dialog. |
| `DateTimePicker.jsx` | 58 | Drop-in replacement for a single <input type="datetime-local">. |
| `DayTimeline.jsx` | 149 | One track of a day timeline: gridlines, open windows, and the blocks sitting on it. |
| `DetailPrimitives.jsx` | 96 | The shared shell for the Booking Details and Short Order Details pages. |
| `FilterBar.jsx` | 134 | One filter system, the same on every page. |
| `ImageUploadField.jsx` | 107 | One image picker, used everywhere the app takes an image. |
| `LoadingScreen.jsx` | 16 | Full-screen spinner shown while the app checks for an existing session on first load (AuthContext `initializing`), so a signed-in manager never sees the login page... |
| `ModalTotal.jsx` | 36 | The figure a manager opened the modal to see, kept where they can always see it. |
| `OverrideStatusModal.jsx` | 182 | The sanctioned exception to the payment policy. |
| `PasswordChecklist.jsx` | 31 | Live checklist under a new-password field: one line per rule in utils/passwordPolicy.js, turning green as each is met. |
| `PasswordConfirmModal.jsx` | 89 | Same shell as ConfirmModal.jsx (icon header, white rounded-2xl card, Cancel/Confirm footer) with a password field swapped in for the message body, since this modal... |
| `PaymentAccountsSettings.jsx` | 308 | Settings -> Payment Details: the GCash and bank accounts customers pay into. |
| `PaymentsReceivedBreakdown.jsx` | 83 | Where the Cash Receipts figure comes from: every Confirmed / Completed booking with an event in the period and money paid toward it, plus the period's... |
| `ProtectedRoute.jsx` | 27 | Guards every /app route. |
| `ReceiptFields.jsx` | 130 | The body of every "Record Receipt" form: amount, method, and the proof the method actually has. |
| `RefundMethodField.jsx` | 55 | How the money went back to the customer. |
| `ReviewFlagBanner.jsx` | 63 | The system changed this booking and wants a manager to look at it. |
| `Select.jsx` | 200 | A drop-in replacement for the native <select> that opens the same kind of floating panel as the nav bar's profile menu (rounded-xl, shadow-lg, border) instead of the... |
| `StatusHistory.jsx` | 94 | "Why did this change?" — answered from booking_status_log, which a database trigger writes on every status change whatever caused it: the 50% auto- confirm, the... |

## `src/contexts/`

| File | Lines | What it is |
|---|---:|---|
| `AuthContext.jsx` | 530 | Who is signed in, and whether they are a manager. |
| `ConfirmContext.jsx` | 62 | Promise-based confirm dialog. |
| `PasswordConfirmContext.jsx` | 103 | Re-verifies the currently logged-in manager's own password before a permanent-delete action proceeds — confirms "it's really you", not a separate secret to manage. |

## `src/hooks/`

| File | Lines | What it is |
|---|---:|---|
| `useApprovalHandlers.js` | 423 | Approving a Pending booking or short order (Pending -> Approved). |
| `useCancellationHandlers.js` | 227 | Cancelling a booking or short order, with an optional refund. |
| `useCompletionHandlers.js` | 100 | Manual "Mark as Completed" action: Confirmed -> Completed. |
| `useConfirmationHandlers.js` | 126 | Manual "Confirm Event" action: Approved -> Confirmed. |
| `usePaymentHandlers.js` | 264 | Recording a payment against a booking or short order. |
| `useRealtimeRefresh.js` | 94 | Keeps a page live: subscribes to database changes on the given tables and re-fetches when they happen. |
| `useRejectionHandlers.js` | 247 | Rejecting a booking or short order, with a reason and, where money was paid, a refund. |
| `useVerificationHandlers.js` | 144 | Manager-side review of a customer-submitted payment (Updated Flow: the customer pays and uploads proof, the payment lands as "Pending Verification", and the manager... |

## `src/layouts/`

| File | Lines | What it is |
|---|---:|---|
| `ManagerLayout.jsx` | 388 | The frame around every signed-in page: the green top bar (logo, name, profile menu, sign out), the sidebar navigation (Management and Inventory groups, Settings), and... |

## `src/pages/`

| File | Lines | What it is |
|---|---:|---|
| `BookingDetails.jsx` | 3,732 | Booking Details -- /app/bookings/:id |
| `Bookings.jsx` | 2,764 | Bookings -- /app/bookings |
| `Customers.jsx` | 1,505 | The customer directory. |
| `Dashboard.jsx` | 1,358 | Overview (Dashboard) -- /app |
| `Equipment.jsx` | 4,095 | Equipment -- /app/equipment |
| `ForgotPassword.jsx` | 334 | Forgot Password -- /forgot-password |
| `LegalPages.jsx` | 195 | Public Privacy Notice (/privacy) and Terms of Service (/terms) for PG's Catering / CaterSync. |
| `Login.jsx` | 350 | Login -- /login |
| `Receivables.jsx` | 1,080 | Money collected, and money still to collect. |
| `ResetPassword.jsx` | 238 | Reset Password -- /reset-password |
| `SettingsPage.jsx` | 560 | Settings -- /app/settings |
| `ShortOrderDetails.jsx` | 2,511 | Short Order Details -- /app/orders/:id |
| `ShortOrders.jsx` | 2,592 | Short Orders -- /app/orders |
| `Vehicles.jsx` | 3,096 | Vehicles -- /app/vehicles |

## `src/pages/PackagesAndMenus/`

| File | Lines | What it is |
|---|---:|---|
| `CategoryManagerModal.jsx` | 77 | Pop-up for managing menu categories (add, edit, delete). |
| `ImageWithFallback.jsx` | 35 | A package or menu-item photo that falls back to a placeholder icon when the image is missing or fails to load. |
| `ItemFormModal.jsx` | 493 | The Add / Edit form for a catering package or a menu item: name, price and pricing type, guest limits, included categories and equipment (packages), motif colours,... |
| `MenuItemCard.jsx` | 60 | One menu item in the Packages & Menus grid: photo, name, category, price per tray, and its Edit / Archive / Delete actions. |
| `PackageCard.jsx` | 124 | One catering package in the Packages & Menus grid: photo, price and pricing type, guest limits, included categories and equipment, and its Edit / Archive / Delete... |
| `constants.js` | 62 | Shared values for Packages & Menus: the motif colour list and its swatches, and the empty form a new package or menu item starts from. |
| `index.jsx` | 1,512 | Packages & Menus -- /app/packages-menu |

## `src/pages/Reports/`

| File | Lines | What it is |
|---|---:|---|
| `BookingSummaryTab.jsx` | 108 | Reports -> Booking Summary tab: the bookings in the selected period as one table, with totals cards computed from the same rows so the two always agree. |
| `DateRangeFilter.jsx` | 153 | The date-range control used across the app (Reports and Receivables period, and every list's date filters). |
| `DetailModal.jsx` | 368 | The record list that opens when a Reports card or chart is clicked: the bookings or payments behind the figure, with a search box, so a manager can check any number... |
| `FinancialTab.jsx` | 331 | Reports -> Financial tab: Gross Revenue, Cash Receipts and Accounts Receivable for the period, the monthly trend, and refunds. |
| `MenuPerformanceTab.jsx` | 352 | Three separate mixes, never one merged ranking. |
| `OverviewTab.jsx` | 167 | Reports -> Overview tab. |
| `SimpleDetailModal.jsx` | 66 | A small read-only pop-up with the key facts of one record (title, a line of explanation, a status badge, a short list of fields). |
| `helpers.js` | 362 | Formatting and period helpers for Reports: peso and date formats, the date-range presets, period wording ("for September"), card styles, and month grouping for the... |
| `index.jsx` | 681 | Reports -- /app/reports |

## `src/utils/`

| File | Lines | What it is |
|---|---:|---|
| `autoComplete.js` | 77 | There's no backend cron/scheduled job in this stack — the DB is Supabase with no server-side functions wired up here — so "automatically" marking a Confirmed... |
| `availability.js` | 72 | Shows a manager reviewing a Pending booking/order what else is already approved on that same calendar day, so they can judge whether the date and time actually work... |
| `bookingSearch.js` | 47 | The search box on the Bookings and Short Orders lists: "Customer name or reference". |
| `bookingSheet.js` | 183 | The one-page "Booking Details" sheet the kitchen and staff work from — a clean version of the paper form PG's Catering already uses (date, name, contact, venue, time,... |
| `bookingStatus.js` | 109 | Full booking lifecycle: Pending -> Approved -> Confirmed -> Completed, with Rejected/Cancelled as terminal branches. |
| `bulkDeleteBookings.js` | 79 | Bulk-deletes bookings or short orders by id, for the Bookings and Short Orders lists. |
| `businessProfile.js` | 82 | PG's Catering's own name and public contact details, kept in the one-row table public.business_profile and edited by the manager in Settings -> Business Details. |
| `completion.js` | 29 | When a Confirmed booking or order may be marked Completed — one rule for the list pages, the detail pages and the completion handlers, so a button that looks ready is... |
| `confirmBooking.js` | 100 | The "Confirm Event" rule, in one place. |
| `createWalkInCustomer.jsx` | 192 | Creates an account for a walk-in customer (someone booking at the counter rather than through the mobile app): signs them up with a one-time password, saves the... |
| `currentManager.js` | 70 | Who is doing this? |
| `customerPicker.js` | 18 | Which customers the "Existing customer" picker on the new Booking and new Short Order forms lists. |
| `datetimeLocal.js` | 34 | One conversion, because getting it wrong is silent and cumulative. |
| `detailFormat.js` | 50 | Display helpers for the Booking Details and Short Order Details pages. |
| `equipment.jsx` | 772 | Equipment rules shared by Bookings, Booking Details, Equipment and Reports: how many units an event needs (deriveEquipmentDemand), allocating them on approval... |
| `equipmentAvailability.js` | 81 | "How much of this item is actually free on the event's date?" — asked of the database, which owns the answer. |
| `fetchAllRows.js` | 46 | Paged reads, so a page's figures don't silently go wrong as the data grows. |
| `formErrors.js` | 13 | Shared helper so every form in the app highlights an invalid field the same way — red border/ring/tint on the input, red inline text below it — instead of leaving the... |
| `keptDeposits.js` | 35 | Reads what keptDepositsFor needs for one period and returns its answer. |
| `lapsed.js` | 70 | A booking request whose event date passed while it was still waiting for a decision has LAPSED. |
| `managerSession.js` | 252 | Enforces "one active BROWSER session per manager account" by storing a per-login session id on manager.active_session_id and comparing it against an id kept in... |
| `overdue.js` | 53 | How a past-due booking looks and reads, in one place, because the Bookings page and the Short Orders page both show it and a manager comparing the two must not see... |
| `packageRules.js` | 72 | What headcount a package will actually accept. |
| `passwordPolicy.js` | 32 | The password rules (at least 8 characters, upper and lower case, a number and a symbol), as one error message (getPasswordPolicyError) and as a per-rule checklist... |
| `payments.js` | 348 | A payment row can exist in a "not yet confirmed" state — submitted by the customer and awaiting manager review (Pending Verification), or reviewed and turned down... |
| `refundEvidence.js` | 48 | The evidence a refund carries, decided by how the money went back — the same rule receipts already follow (methodNeedsReceiptNumber in utils/payments): |
| `reportMetrics.js` | 174 | The booking-status lists the money definitions are built on, and one date helper. |
| `resourceLock.js` | 55 | When a booking's equipment and vehicles can be changed. |
| `statusLabels.js` | 59 | One vocabulary for the assignment lifecycle, shared by Equipment and Vehicles. |
| `timeline.js` | 121 | The colour vocabulary and geometry behind every "trips laid on a day" view. |
| `vehicle.js` | 1,694 | Vehicles are unit-based, not stock-based — each row in `vehicle` is one physical car/motorcycle, so there is no quantity column the way `equipment` has. |
| `verifyPassword.js` | 81 | Re-verifies the manager's own password (used before permanent deletes) WITHOUT touching the app's real Supabase session. |

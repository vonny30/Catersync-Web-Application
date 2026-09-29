// src/pages/LegalPages.jsx
// Public Privacy Notice (/privacy) and Terms of Service (/terms) for
// PG's Catering / CaterSync. Written for the Philippine Data Privacy Act of
// 2012 (RA 10173). The customer mobile app should link to both pages at
// sign-up (see docs/mobile-security-notes.md).
//
// The business name and contact details come from Settings -> Business
// Details (public.business_profile), so the manager keeps them current.
// Have PG's Catering read both pages — they are its promises to customers.
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useBusinessProfile, formatPhone } from '../utils/businessProfile';

const LAST_UPDATED = 'September 29, 2026';

function LegalLayout({ title, children }) {
  const business = useBusinessProfile();
  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[760px] mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#007038] hover:text-[#00532a]">
          <ArrowLeft size={16} /> Back
        </Link>
        <h1 className="mt-6 text-[28px] sm:text-[32px] font-bold text-slate-900 leading-tight">{title}</h1>
        <p className="mt-2 text-[14px] text-slate-500">{business.business_name} · CaterSync · Last updated {LAST_UPDATED}</p>
        <div className="mt-8 flex flex-col gap-7 text-[15.5px] leading-[1.7] text-slate-700 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
          {children}
        </div>
        <div className="mt-12 pt-6 border-t border-slate-200 flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
          <Link to="/privacy" className="font-semibold text-[#007038] hover:text-[#00532a]">Privacy Notice</Link>
          <Link to="/terms" className="font-semibold text-[#007038] hover:text-[#00532a]">Terms of Service</Link>
        </div>
      </div>
    </div>
  );
}

function ContactBlock() {
  const business = useBusinessProfile();
  const rows = [
    business.email && (
      <li key="email">Email: <a href={`mailto:${business.email}`} className="font-semibold text-[#007038] hover:text-[#00532a]">{business.email}</a></li>
    ),
    business.phone && (
      <li key="phone">Mobile: <a href={`tel:${business.phone}`} className="font-semibold text-[#007038] hover:text-[#00532a]">{formatPhone(business.phone)}</a></li>
    ),
    business.address && <li key="address">Address: {business.address}</li>,
  ].filter(Boolean);
  if (rows.length === 0) {
    return <p>Please contact {business.business_name} through the CaterSync app or at its place of business.</p>;
  }
  return <ul>{rows}</ul>;
}

export function PrivacyNotice() {
  const { business_name: name } = useBusinessProfile();
  return (
    <LegalLayout title="Privacy Notice">
      <section>
        <p>
          {name} uses CaterSync — a customer mobile app, two staff apps and a manager website — to take and
          manage catering bookings. This notice explains what personal information we collect through CaterSync, why,
          who can see it, and the rights you have under the Data Privacy Act of 2012 (Republic Act No. 10173).
          {' '}{name} is responsible for your information as its personal information controller.
        </p>
      </section>

      <section>
        <h2>What we collect</h2>
        <ul>
          <li><strong>Account details:</strong> your name, email address, mobile number, address and username, and a profile photo if you add one.</li>
          <li><strong>Booking details:</strong> event date and time, venue, number of guests, package and menu choices, and any notes you give us.</li>
          <li><strong>Payment details:</strong> amounts, payment method, dates, reference numbers, and the proof-of-payment images you upload. A screenshot may show your name or account number, so please crop out anything we don&apos;t need.</li>
          <li><strong>Sign-in data:</strong> the app and this website keep you signed in by storing a session on your device. We do not use advertising or tracking cookies.</li>
        </ul>
      </section>

      <section>
        <h2>Why we use it</h2>
        <ul>
          <li>To receive, review, prepare and deliver your booking — including the kitchen, equipment and vehicle arrangements for your event.</li>
          <li>To record and verify your payments and tell you what you still owe.</li>
          <li>To contact you about your booking.</li>
          <li>To keep the business and tax records the law requires.</li>
          <li>To protect your account and our system from misuse.</li>
        </ul>
        <p className="mt-2">We do not sell your information, and we do not send you marketing without asking first.</p>
      </section>

      <section>
        <h2>Who can see it</h2>
        <ul>
          <li><strong>Our staff, only as their job needs:</strong> the manager sees bookings and payments; the Main Cook and Operations Manager see the event details they need to prepare and deliver your event.</li>
          <li><strong>Service providers that run CaterSync for us:</strong> Supabase (database, sign-in and file storage, with servers in Seoul, South Korea) and Vercel (website hosting). They store the data on our behalf and may not use it for anything else.</li>
          <li><strong>Government authorities,</strong> only when the law requires it.</li>
        </ul>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <p>
          We keep your account and booking information while your account is active and for as long as we need it to
          serve you. Payment and booking records are kept for as long as Philippine tax and accounting rules require.
          After that, we delete or anonymise them.
        </p>
      </section>

      <section>
        <h2>How we protect it</h2>
        <p>
          Connections to CaterSync are encrypted. Each person can only reach the information their role needs:
          customers see only their own bookings and payments, and payment proofs are stored under hard-to-guess links
          that other users cannot browse or list. Staff accounts are password-protected, and sensitive actions ask for
          the password again.
        </p>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>Under the Data Privacy Act you have the right to:</p>
        <ul>
          <li>be told how your information is used (this notice);</li>
          <li>see the information we hold about you and get a copy of it;</li>
          <li>have wrong or incomplete information corrected;</li>
          <li>object to, or ask us to stop, processing that is no longer needed, and ask for your information to be deleted or blocked, subject to records the law requires us to keep;</li>
          <li>be compensated for damage caused by misuse of your information; and</li>
          <li>file a complaint with the National Privacy Commission (privacy.gov.ph).</li>
        </ul>
        <p className="mt-2">To use any of these rights, contact us:</p>
        <ContactBlock />
      </section>

      <section>
        <h2>Changes to this notice</h2>
        <p>If we change this notice, we will update the date at the top and tell you in the app if the change affects you.</p>
      </section>
    </LegalLayout>
  );
}

export function TermsOfService() {
  const { business_name: name } = useBusinessProfile();
  return (
    <LegalLayout title="Terms of Service">
      <section>
        <p>
          These terms apply when you use the CaterSync app to book catering from {name}. By creating an
          account or placing a booking, you agree to them. How we handle your personal information is explained in
          our <Link to="/privacy" className="font-semibold text-[#007038] hover:text-[#00532a]">Privacy Notice</Link>.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <ul>
          <li>Give accurate details and keep them up to date, so we can reach you about your event.</li>
          <li>Keep your password to yourself. You are responsible for bookings made through your account.</li>
          <li>We may suspend an account that is used to make false bookings, submit false payment proofs, or misuse the system.</li>
        </ul>
      </section>

      <section>
        <h2>Bookings</h2>
        <ul>
          <li>Bookings must be made at least 3 days before the event.</li>
          <li>A booking you submit is a request. It becomes an order only when {name} accepts it, and the final price is the one shown on the accepted booking.</li>
          <li>Delivery is free within Bayawan City, Santa Catalina and Basay. A delivery fee may apply outside these areas.</li>
        </ul>
      </section>

      <section>
        <h2>Payments</h2>
        <ul>
          <li>Your booking is confirmed once payments of at least 50% of the total have been received and verified by {name}.</li>
          <li>A payment you submit in the app shows as awaiting verification until the manager checks it against the proof you uploaded. Only genuine proofs may be uploaded.</li>
          <li>Cash payments can be made at our place of business and are recorded by the manager.</li>
        </ul>
      </section>

      <section>
        <h2>Cancellations and refunds</h2>
        <p>
          You can cancel a booking in the app. Whether any amount already paid is refunded depends on {name}&apos;s
          cancellation policy as agreed for your booking; some payments may be non-refundable. Please contact us before
          cancelling if you are unsure.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <ContactBlock />
      </section>
    </LegalLayout>
  );
}

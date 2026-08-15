// src/pages/PackagesAndMenus/ImageWithFallback.jsx
import { useState } from 'react';

const FallbackIcon = ({ className }) => (
  <div className={`${className} flex items-center justify-center bg-slate-100 text-slate-400`}>
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
    <span className="sr-only">No Image</span>
  </div>
);

// Same fallback behavior as before (blank/broken image -> placeholder
// icon), just driven by React state instead of manually building DOM
// nodes in an onError handler.
export default function ImageWithFallback({ src, alt, className }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return <FallbackIcon className={className} />;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

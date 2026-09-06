// src/components/ImageUploadField.jsx
//
// One image picker, used everywhere the app takes an image.
//
// There were thirteen file inputs across six files and only ONE of them —
// the menu-item form in Packages & Menus — showed you what you had picked.
// The other twelve were a dashed box that swapped in a filename, so a manager
// uploading proof of a ₱15,000 payment had no way to tell they had attached
// the wrong screenshot until after it was saved. The one that got it right is
// the model here; this is that field, extracted.
//
// The preview is the newly-picked file when there is one, and otherwise
// whatever image is already stored (`existingUrl`), so an edit form shows the
// current image rather than an empty box.
//
// `onChange` receives the raw change event, not the file, because the callers
// disagree about what to do with it: some set state directly, others run
// validation first (size, MIME type) and set an error string. Handing over the
// event lets both keep their own behaviour.
import { useEffect, useMemo } from 'react';
import { Image as ImageIcon } from 'lucide-react';

export default function ImageUploadField({
  label,
  file,
  onChange,
  error = '',
  hint = 'PNG, JPG up to 5MB',
  required = false,
  note = '',
  existingUrl = null,
  disabled = false,
  placeholder = 'Click to upload image',
  name,
}) {
  // Derived, not stored. The obvious version keeps the URL in state and sets it
  // from an effect — which trips react-hooks/set-state-in-effect, the rule this
  // codebase goes out of its way to keep reported. useMemo gives the same
  // result with no state and no extra render.
  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  // The effect exists ONLY to revoke. Without it every re-pick leaks a blob for
  // as long as the tab lives.
  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  // A freshly picked file wins; otherwise show whatever is already stored, so
  // an edit form opens with its current image rather than an empty box.
  const previewUrl = objectUrl || existingUrl || null;

  return (
    <div>
      {label && (
        <label className="block text-xs font-bold text-slate-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
          {note && <span className="text-xs font-normal text-slate-400 ml-1">{note}</span>}
        </label>
      )}

      <div className="flex gap-3 items-start">
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Preview"
            className="w-20 h-20 rounded-lg object-cover border border-slate-200 shrink-0"
          />
        )}
        <label
          className={`flex-1 border-2 border-dashed rounded-lg h-20 flex flex-col items-center justify-center transition-colors relative overflow-hidden ${
            disabled ? 'opacity-50 cursor-wait' : 'cursor-pointer'
          } ${
            error
              ? 'border-red-400 bg-red-50/40 hover:bg-red-50'
              : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
          }`}
        >
          <input
            type="file"
            name={name}
            accept="image/*"
            onChange={onChange}
            disabled={disabled}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-wait"
          />
          {file ? (
            <span className="text-[13px] font-semibold text-[#007038] px-2 text-center break-all line-clamp-2">
              {file.name}
            </span>
          ) : (
            <>
              <ImageIcon size={20} className={`mb-1 ${error ? 'text-red-400' : 'text-slate-400'}`} />
              <span className="text-xs font-medium text-slate-500 text-center px-2">{placeholder}</span>
            </>
          )}
        </label>
      </div>

      {error ? (
        <p className="text-xs text-red-600 mt-1 font-semibold">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-slate-400 mt-1">{hint}</p>
      ) : null}
    </div>
  );
}

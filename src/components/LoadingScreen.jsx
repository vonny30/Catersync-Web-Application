// src/components/LoadingScreen.jsx
export default function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-[#008A45] mx-auto mb-4"></div>
        <p className="text-slate-600 font-semibold text-lg">Loading, please wait...</p>
      </div>
    </div>
  );
}
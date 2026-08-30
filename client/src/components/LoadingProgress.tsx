export function LoadingProgress({ label = 'טוען...' }: { label?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
      <div className="h-12 w-12 rounded-full border-4 border-navy/15 border-t-gold animate-spin" />
      <p className="text-slate-500 text-sm">{label}</p>
    </div>
  );
}

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse">
      <div className="mb-7">
        <div className="h-8 w-56 rounded-lg bg-white/5" />
        <div className="mt-2.5 h-4 w-80 max-w-full rounded bg-white/[0.04]" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="panel h-24 rounded-2xl" />)}
      </div>
      <div className="panel mt-6 h-80 rounded-2xl" />
    </div>
  );
}

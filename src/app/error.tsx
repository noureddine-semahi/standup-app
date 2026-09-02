"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="card text-center max-w-md">
        <h1 className="text-3xl font-bold mb-2">Something went wrong</h1>
        <p className="text-white/70 mb-6">{error.message || "An unexpected error occurred."}</p>
        <button onClick={() => reset()} className="btn btn-primary">
          Try again
        </button>
      </div>
    </div>
  );
}

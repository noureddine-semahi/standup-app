import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="card text-center">
        <h1 className="text-3xl font-bold mb-2">Page not found</h1>
        <p className="text-white/70 mb-6">
          The page you're looking for doesn't exist or was moved.
        </p>
        <Link href="/" className="btn btn-primary">
          Back home
        </Link>
      </div>
    </div>
  );
}

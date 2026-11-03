import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-navy-900">Not found</h1>
      <p className="mt-2 text-slate-600">That permit or page doesn&apos;t exist.</p>
      <Link href="/" className="mt-4 inline-block text-navy-600 underline">Back to search</Link>
    </div>
  );
}

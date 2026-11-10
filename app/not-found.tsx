import Link from "next/link";

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="grid-field flex min-h-screen items-center justify-center px-4"
    >
      <div className="panel w-full max-w-md p-8 text-center">
        <p className="eyebrow">Page not found</p>
        <h1 className="mt-3 text-xl font-semibold text-gray-900 dark:text-white">
          We can’t find that page
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          The link may be old, or the job may have been removed.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/jobs" className="btn-ink">
            Find jobs
          </Link>
          <Link href="/" className="btn-outline">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}

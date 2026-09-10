import Link from "next/link";

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="grid-field flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900"
    >
      <div className="panel w-full max-w-md p-8 text-center">
        <p className="eyebrow">Error 404</p>
        <h1 className="mt-3 text-xl font-semibold text-gray-900 dark:text-white">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          The link may be out of date, or the role may have been taken down.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/jobs" className="btn-ink">
            Explore roles
          </Link>
          <Link href="/" className="btn-outline">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}

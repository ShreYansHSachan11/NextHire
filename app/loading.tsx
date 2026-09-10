export default function Loading() {
  return (
    <div className="grid-field flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center" role="status">
        <div
          className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-green-500 dark:border-gray-700 dark:border-t-green-400"
          aria-hidden="true"
        />
        <p className="eyebrow mt-4">Loading</p>
      </div>
    </div>
  );
}

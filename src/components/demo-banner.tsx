export function DemoBanner() {
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-sm leading-6 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <p>
        This is a demo with sample data. Alex and Jordan are fictional. Nothing
        you do here is saved.
      </p>
      <form action="/auth/sign-out" method="post">
        <button type="submit" className="btn-quiet">
          Exit demo
        </button>
      </form>
    </div>
  );
}

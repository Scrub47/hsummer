export default function CirclesLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-8">
      <div className="skeleton h-8 w-28" />
      <div className="skeleton h-16 w-full" />
      <div className="skeleton h-16 w-full" />
      <div className="skeleton h-12 w-40" />
    </div>
  );
}

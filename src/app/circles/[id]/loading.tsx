export default function CircleLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-8">
      <div className="skeleton h-4 w-20" />
      <div className="skeleton h-8 w-48" />
      <div className="skeleton h-12 w-full" />
      <div className="skeleton h-40 w-full" />
    </div>
  );
}

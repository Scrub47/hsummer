export default function ProfileLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <div className="skeleton h-8 w-32" />
      <div className="skeleton h-24 w-24 rounded-full" />
      <div className="skeleton h-12 w-full" />
      <div className="skeleton h-12 w-full" />
    </div>
  );
}

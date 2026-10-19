import { BearMark } from "@/components/bear-mark";

export default function HomeLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <BearMark size={72} alt="" />
      <div className="skeleton h-8 w-32" />
      <div className="skeleton h-48 w-full" />
      <div className="skeleton h-12 w-full" />
    </div>
  );
}

import { BearMark } from "@/components/bear-mark";

export default function Loading() {
  return (
    <div className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col items-center justify-center gap-4 px-6">
      <BearMark size={140} priority alt="Hsummer" />
      <p className="font-hand text-4xl">Hsummer</p>
      <div className="skeleton h-4 w-40" />
    </div>
  );
}

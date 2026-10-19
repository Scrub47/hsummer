import { BearMark } from "@/components/bear-mark";

export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="empty-state">
      <BearMark size={112} alt="" />
      <p className="font-hand text-3xl">{title}</p>
      {detail ? <p className="max-w-xs text-sm text-muted">{detail}</p> : null}
    </div>
  );
}

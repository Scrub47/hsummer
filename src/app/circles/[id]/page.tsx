import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { CircleScreen } from "@/components/circle-screen";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Circle",
};

export default async function CirclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const { id } = await params;
  if (!id) notFound();
  return <CircleScreen session={session} circleId={id} />;
}

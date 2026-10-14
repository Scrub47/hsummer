import type { LetterDesign } from "@/lib/letters/fields";

export type LetterCategory = {
  id: string;
  label: string;
};

export type LetterCard = {
  id: string;
  fromUserId: string | null;
  toUserId: string;
  category: string;
  categoryLabel: string;
  title: string | null;
  /**
   * Null while the recipient has not opened it. The row is already
   * delivered, so the database would return the body. The page does not
   * send it down until the seal breaks.
   */
  body: string | null;
  design: LetterDesign;
  status: "scheduled" | "delivered" | "cancelled";
  scheduledFor: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  createdAt: string;
  mine: boolean;
  sealed: boolean;
  dearName: string;
  fromName: string;
};

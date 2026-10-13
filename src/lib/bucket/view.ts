import type { BucketCategory, BucketStatus } from "@/lib/bucket/fields";

/** One row, already checked and labeled for the circle page. */
export type BucketItemView = {
  id: string;
  title: string;
  category: BucketCategory;
  status: BucketStatus;
  plannedDate: string | null;
  completedAt: string | null;
  notes: string | null;
  link: string | null;
  createdBy: string | null;
  author: string;
  createdAt: string;
  updatedAt: string;
};

"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import {
  addBucketItem,
  type BucketActionState,
} from "@/app/circles/bucket-actions";
import { BucketItem } from "@/components/bucket-item";
import { useCircleLive } from "@/components/use-circle-live";
import {
  BUCKET_CATEGORIES,
  BUCKET_NOTES_MAX,
  BUCKET_STATUSES,
  BUCKET_TITLE_MAX,
  type BucketStatus,
} from "@/lib/bucket/fields";
import type { BucketItemView } from "@/lib/bucket/view";

const initialState: BucketActionState = { error: null, saved: false };

const GROUP_LABEL: Record<BucketStatus, string> = {
  idea: "Ideas",
  planned: "Planned",
  done: "Done",
};

/**
 * The shared list. Saves go through server actions, so row-level security
 * still applies. A Realtime subscription refreshes this page when the other
 * person edits. If Realtime is off, their own saves still show up.
 */
export function BucketList({
  circleId,
  items,
  pending,
}: {
  circleId: string;
  items: BucketItemView[];
  pending: boolean;
}) {
  const router = useRouter();
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);
  const live = useCircleLive(circleId, "bucket_items", refresh);
  const announcement = useUpdateAnnouncement(items);
  const [state, formAction, pendingSave] = useActionState(
    addBucketItem,
    initialState,
  );
  const [formKey, setFormKey] = useState(0);
  const seen = useRef(state);

  useEffect(() => {
    if (state.saved && state !== seen.current) {
      seen.current = state;
      setFormKey((key) => key + 1);
    }
  }, [state]);

  return (
    <section aria-labelledby="bucket-heading" className="flex flex-col gap-6">
      <div>
        <h2 id="bucket-heading" className="font-serif text-3xl tracking-tight">
          Bucket list
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-foreground/80">
          {pending
            ? "Start the list now. Your partner sees it, and can edit it, once they join."
            : "Restaurants, movies, things to do, and plans for when you're in the same place. You can both edit it."}
        </p>
        <p className="mt-2 text-sm text-foreground/70" role="status">
          {live === "live"
            ? "Live. Changes show up here for everyone in the circle."
            : live === "connecting"
              ? "Connecting live updates…"
              : "Live updates aren't connected. Saves still stick. Reload to see someone else's edits."}
        </p>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>

      <form
        key={formKey}
        action={formAction}
        className="flex flex-col gap-4 rounded-3xl border border-line bg-card p-5"
      >
        <input type="hidden" name="circleId" value={circleId} />
        <h3 className="font-serif text-2xl tracking-tight">Add something</h3>
        <div className="flex flex-col gap-2">
          <label htmlFor="bucket-new-title" className="text-sm font-medium">
            Title
          </label>
          <input
            id="bucket-new-title"
            name="title"
            required
            maxLength={BUCKET_TITLE_MAX}
            placeholder="Night market"
            className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="bucket-new-category"
              className="text-sm font-medium"
            >
              Category
            </label>
            <select
              id="bucket-new-category"
              name="category"
              defaultValue="activity"
              className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
            >
              {BUCKET_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="bucket-new-status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="bucket-new-status"
              name="status"
              defaultValue="idea"
              className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
            >
              {BUCKET_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="bucket-new-date" className="text-sm font-medium">
              Planned date{" "}
              <span className="font-normal text-foreground/60">(optional)</span>
            </label>
            <input
              id="bucket-new-date"
              name="plannedDate"
              type="date"
              className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="bucket-new-link" className="text-sm font-medium">
              Link{" "}
              <span className="font-normal text-foreground/60">(optional)</span>
            </label>
            <input
              id="bucket-new-link"
              name="link"
              type="url"
              inputMode="url"
              placeholder="https://"
              className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="bucket-new-notes" className="text-sm font-medium">
            Notes{" "}
            <span className="font-normal text-foreground/60">(optional)</span>
          </label>
          <textarea
            id="bucket-new-notes"
            name="notes"
            maxLength={BUCKET_NOTES_MAX}
            rows={3}
            className="rounded-2xl border border-line bg-background px-4 py-3 text-base"
          />
        </div>
        {state.error ? (
          <p className="text-sm leading-6" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.saved ? (
          <p className="text-sm leading-6 text-foreground/70" role="status">
            Added.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pendingSave}
          className="inline-flex h-12 items-center justify-center self-start rounded-full bg-accent px-6 text-sm font-medium text-accent-ink disabled:opacity-60"
        >
          {pendingSave ? "Adding…" : "Add to the list"}
        </button>
      </form>

      {items.length === 0 ? (
        <p className="text-sm leading-6 text-foreground/70">
          Nothing here yet. Add a restaurant, a movie, or a plan for the next
          time you&apos;re together.
        </p>
      ) : (
        BUCKET_STATUSES.map((status) => {
          const group = items.filter((item) => item.status === status.value);
          if (group.length === 0) return null;
          return (
            <div key={status.value} className="flex flex-col gap-3">
              <h3 className="font-serif text-2xl tracking-tight">
                {GROUP_LABEL[status.value]}
              </h3>
              <ul className="flex flex-col gap-3">
                {group.map((item) => (
                  <BucketItem
                    key={`${item.id}:${item.updatedAt}`}
                    circleId={circleId}
                    item={item}
                  />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}

function useUpdateAnnouncement(items: BucketItemView[]): string {
  const signature = items
    .map((item) => `${item.id}:${item.updatedAt}`)
    .join("|");
  const first = useRef(true);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setAnnouncement("Bucket list updated.");
  }, [signature]);

  return announcement;
}

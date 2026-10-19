"use client";

import { useActionState, useState } from "react";

import {
  deleteBucketItem,
  updateBucketItem,
  type BucketActionState,
} from "@/app/circles/bucket-actions";
import {
  BUCKET_CATEGORIES,
  BUCKET_NOTES_MAX,
  BUCKET_STATUSES,
  BUCKET_TITLE_MAX,
  categoryLabel,
  formatPlannedDate,
} from "@/lib/bucket/fields";
import type { BucketItemView } from "@/lib/bucket/view";

const initialState: BucketActionState = { error: null, saved: false };

/**
 * One shared item. Any active member can change it. The card remounts when
 * `updatedAt` changes so a partner's edit replaces a half-typed draft.
 */
export function BucketItem({
  circleId,
  item,
}: {
  circleId: string;
  item: BucketItemView;
}) {
  const [state, formAction, pending] = useActionState(
    updateBucketItem,
    initialState,
  );
  const [removeState, removeAction, removing] = useActionState(
    deleteBucketItem,
    initialState,
  );
  const [confirming, setConfirming] = useState(false);
  const titleId = `bucket-title-${item.id}`;
  const done = item.status === "done";

  return (
    <li className="overflow-hidden rounded-3xl border border-line bg-card">
      <details className="fold">
        <summary>
          <span className={done ? "line-through" : ""}>{item.title}</span>
          <span className="text-sm font-medium text-muted">
            {item.status === "done"
              ? "Done"
              : item.status === "planned"
                ? "Planned"
                : "Idea"}
          </span>
        </summary>
        <form action={formAction} className="flex flex-col gap-3 px-4 pb-3">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="circleId" value={circleId} />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-pine">
              {categoryLabel(item.category)}
              {item.plannedDate
                ? ` · ${formatPlannedDate(item.plannedDate)}`
                : ""}
            </p>
            <p className="text-sm text-foreground/70">Added by {item.author}</p>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={titleId} className="text-sm font-medium">
              Title
            </label>
            <input
              id={titleId}
              name="title"
              required
              maxLength={BUCKET_TITLE_MAX}
              defaultValue={item.title}
              className={`h-12 rounded-2xl border border-line bg-background px-4 text-base ${done ? "text-foreground/70 line-through" : ""}`}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label
                htmlFor={`bucket-category-${item.id}`}
                className="text-sm font-medium"
              >
                Category
              </label>
              <select
                id={`bucket-category-${item.id}`}
                name="category"
                defaultValue={item.category}
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
              <label
                htmlFor={`bucket-status-${item.id}`}
                className="text-sm font-medium"
              >
                Status
              </label>
              <select
                id={`bucket-status-${item.id}`}
                name="status"
                defaultValue={item.status}
                disabled={pending}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
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
              <label
                htmlFor={`bucket-date-${item.id}`}
                className="text-sm font-medium"
              >
                Planned date{" "}
                <span className="font-normal text-foreground/60">
                  (optional)
                </span>
              </label>
              <input
                id={`bucket-date-${item.id}`}
                name="plannedDate"
                type="date"
                defaultValue={item.plannedDate ?? ""}
                className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label
                htmlFor={`bucket-link-${item.id}`}
                className="text-sm font-medium"
              >
                Link{" "}
                <span className="font-normal text-foreground/60">
                  (optional)
                </span>
              </label>
              <input
                id={`bucket-link-${item.id}`}
                name="link"
                type="url"
                inputMode="url"
                defaultValue={item.link ?? ""}
                placeholder="https://"
                className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor={`bucket-notes-${item.id}`}
              className="text-sm font-medium"
            >
              Notes{" "}
              <span className="font-normal text-foreground/60">(optional)</span>
            </label>
            <textarea
              id={`bucket-notes-${item.id}`}
              name="notes"
              maxLength={BUCKET_NOTES_MAX}
              rows={3}
              defaultValue={item.notes ?? ""}
              className="rounded-2xl border border-line bg-background px-4 py-3 text-base"
            />
          </div>
          {item.link ? (
            <p className="text-sm leading-6">
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-pine underline decoration-pine/40"
              >
                Open link
              </a>
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-11 items-center justify-center rounded-full bg-pine px-5 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
          {state.error ? (
            <p className="text-sm leading-6" role="alert">
              {state.error}
            </p>
          ) : null}
          {state.saved ? (
            <p className="text-sm leading-6 text-foreground/70" role="status">
              Saved.
            </p>
          ) : null}
        </form>
        <form action={removeAction} className="mt-3">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="circleId" value={circleId} />
          {confirming ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={removing}
                className="inline-flex h-11 items-center justify-center rounded-full border border-line bg-background px-5 text-sm font-medium disabled:opacity-60"
              >
                {removing ? "Removing…" : `Remove ${item.title}`}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-sm text-foreground/70 underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-sm text-foreground/70 underline"
            >
              Remove
            </button>
          )}
          {removeState.error ? (
            <p className="mt-3 text-sm leading-6" role="alert">
              {removeState.error}
            </p>
          ) : null}
        </form>
      </details>
    </li>
  );
}

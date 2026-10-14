"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

import {
  addMemory,
  deleteMemory,
  type MemoryActionState,
} from "@/app/circles/memory-actions";
import { PhotoStrip } from "@/components/photo-strip";
import { RefreshSignedUrls } from "@/components/refresh-signed-urls";
import { useCircleLive } from "@/components/use-circle-live";
import { filterLabel, layoutLabel } from "@/lib/booth/fields";
import { themeBundle } from "@/lib/booth/themes";
import {
  CAPTION_ERROR,
  MEMORY_CAPTION_MAX,
  MEMORY_NOTE_MAX,
  MEMORY_QUOTA_BYTES,
  MEMORY_SIGNED_URL_SECONDS,
  formatMemoryUsage,
} from "@/lib/memories/fields";
import {
  audienceLabel,
  groupMemories,
  memoryTagList,
  type MemoryCard,
} from "@/lib/memories/group";
import { prepareMemoryPhoto } from "@/lib/memories/prepare-photo";

const initialState: MemoryActionState = { error: null, saved: false };

/**
 * Photos and notes for one circle, grouped by month. A tag narrows that
 * list. Saves go through server actions, so row-level security still applies.
 * Photo links are signed on the server and stop working after a few minutes;
 * a reload asks for a new one.
 */
export function MemoryWall({
  circleId,
  memories,
  people,
  today,
  usedBytes,
  pending,
}: {
  circleId: string;
  memories: MemoryCard[];
  people: { userId: string; displayName: string }[];
  today: string;
  usedBytes: number;
  pending: boolean;
}) {
  const router = useRouter();
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);
  const live = useCircleLive(circleId, "memories", refresh);
  const [tag, setTag] = useState<string | null>(null);
  const tags = memoryTagList(memories);
  const months = groupMemories(memories, tag);
  const hasPhoto = memories.some(
    (memory) => memory.photoUrl || (memory.booth?.shots.length ?? 0) > 0,
  );

  return (
    <section aria-labelledby="memory-heading" className="flex flex-col gap-6">
      <RefreshSignedUrls
        enabled={hasPhoto}
        seconds={MEMORY_SIGNED_URL_SECONDS}
      />
      <div>
        <h2 id="memory-heading" className="font-serif text-3xl tracking-tight">
          Memory wall
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-foreground/80">
          {pending
            ? "Add a note or a photo now. People you share it with see it once they join."
            : "Notes and photos, grouped by month. Choose everyone in the circle, or only some people."}
        </p>
        <p className="mt-2 text-sm text-foreground/70">
          {formatMemoryUsage(usedBytes, MEMORY_QUOTA_BYTES)}
        </p>
        <p className="mt-2 text-sm text-foreground/70" role="status">
          {live === "live"
            ? "Live. New memories show up here for people who can see them."
            : live === "connecting"
              ? "Connecting live updates…"
              : "Live updates aren't connected. Saves still stick. Reload to see someone else's."}
        </p>
      </div>

      <AddMemoryForm circleId={circleId} people={people} today={today} />

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tags">
          <TagButton
            label="All"
            pressed={tag === null}
            onClick={() => setTag(null)}
          />
          {tags.map((item) => (
            <TagButton
              key={item}
              label={item}
              pressed={tag === item}
              onClick={() => setTag(item)}
            />
          ))}
        </div>
      ) : null}

      {months.length === 0 ? (
        <p className="text-sm leading-6 text-foreground/70">
          {memories.length === 0
            ? "Nothing on the wall yet."
            : "Nothing with that tag."}
        </p>
      ) : (
        months.map((month) => (
          <div key={month.key} className="flex flex-col gap-4">
            <h3 className="font-serif text-2xl tracking-tight">
              {month.label}
            </h3>
            <ul className="flex flex-col gap-4">
              {month.memories.map((memory) => (
                <MemoryCardView
                  key={memory.id}
                  circleId={circleId}
                  memory={memory}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function AddMemoryForm({
  circleId,
  people,
  today,
}: {
  circleId: string;
  people: { userId: string; displayName: string }[];
  today: string;
}) {
  const [state, formAction, pendingSave] = useActionState(
    addMemory,
    initialState,
  );
  const [preparing, startPreparing] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [selected, setSelected] = useState(false);
  const seen = useRef(state);

  useEffect(() => {
    if (state.saved && state !== seen.current) {
      seen.current = state;
      setFormKey((key) => key + 1);
      setSelected(false);
      setLocalError(null);
    }
  }, [state]);

  const busy = pendingSave || preparing;
  const error = localError ?? state.error;

  return (
    <form
      key={formKey}
      className="flex flex-col gap-4 rounded-3xl border border-line bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        startPreparing(async () => {
          const data = new FormData(form);
          const photo = data.get("photo");
          const note = data.get("body");
          if (
            photo instanceof File &&
            photo.size > 0 &&
            typeof note === "string" &&
            [...note.trim()].length > MEMORY_CAPTION_MAX
          ) {
            setLocalError(CAPTION_ERROR);
            return;
          }
          if (photo instanceof File && photo.size > 0) {
            const prepared = await prepareMemoryPhoto(photo);
            if (!prepared.ok) {
              setLocalError(prepared.error);
              return;
            }
            data.set("photo", prepared.file);
          }
          setLocalError(null);
          formAction(data);
        });
      }}
    >
      <input type="hidden" name="circleId" value={circleId} />
      <h3 className="font-serif text-2xl tracking-tight">Add a memory</h3>
      <div className="flex flex-col gap-2">
        <label htmlFor="memory-note" className="text-sm font-medium">
          Note
        </label>
        <textarea
          id="memory-note"
          name="body"
          rows={3}
          maxLength={MEMORY_NOTE_MAX}
          placeholder="The ferry was late, and that was the good part."
          className="rounded-2xl border border-line bg-background px-4 py-3 text-base"
        />
        <p className="text-sm text-foreground/70">
          A photo can include a caption up to {MEMORY_CAPTION_MAX} characters.
          Without a photo, this is the memory.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="memory-photo" className="text-sm font-medium">
          Photo
        </label>
        <input
          id="memory-photo"
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="text-base"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="memory-tags" className="text-sm font-medium">
            Tags
          </label>
          <input
            id="memory-tags"
            name="tags"
            placeholder="summer, ferry"
            className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="memory-date" className="text-sm font-medium">
            Date
          </label>
          <input
            id="memory-date"
            name="occurredOn"
            type="date"
            required
            defaultValue={today}
            className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
          />
        </div>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Who can see this</legend>
        <label className="flex items-center gap-3 text-base">
          <input
            type="radio"
            name="visibility"
            value="circle"
            defaultChecked
            onChange={() => setSelected(false)}
          />
          Everyone in the circle
        </label>
        <label className="flex items-center gap-3 text-base">
          <input
            type="radio"
            name="visibility"
            value="selected"
            onChange={() => setSelected(true)}
          />
          Only selected people
        </label>
        {selected ? (
          <div className="flex flex-col gap-2 pl-7">
            {people.length === 0 ? (
              <p className="text-sm text-foreground/70">
                Only you will see this until someone else is here.
              </p>
            ) : (
              people.map((person) => (
                <label
                  key={person.userId}
                  className="flex items-center gap-3 text-base"
                >
                  <input type="checkbox" name="viewer" value={person.userId} />
                  {person.displayName}
                </label>
              ))
            )}
          </div>
        ) : null}
      </fieldset>
      {error ? (
        <p className="text-sm text-accent" role="alert">
          {error}
        </p>
      ) : null}
      {state.saved && !error ? (
        <p className="text-sm text-pine" role="status">
          Saved on the wall.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="h-12 rounded-full bg-accent px-5 text-base font-medium text-accent-ink disabled:opacity-60"
      >
        {busy ? "Saving…" : "Add to the wall"}
      </button>
    </form>
  );
}

function MemoryCardView({
  circleId,
  memory,
}: {
  circleId: string;
  memory: MemoryCard;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    deleteMemory,
    initialState,
  );
  const label =
    memory.body?.trim() ||
    (memory.kind === "photo-strip" ? "this strip" : "this photo");
  const refreshedUrl = useRef<string | null>(null);

  return (
    <li className="flex flex-col gap-3 rounded-3xl border border-line bg-card p-5">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm font-medium text-pine">{memory.author}</p>
        <p className="text-sm text-foreground/70">{audienceLabel(memory)}</p>
      </div>
      {memory.kind === "photo-strip" && memory.booth ? (
        <div className="flex flex-col gap-3">
          <PhotoStrip
            theme={memory.booth.theme}
            layout={memory.booth.frameLayout}
            dateLabel={stripDate(memory.occurredOn)}
            label={`${themeBundle(memory.booth.theme).label} photo booth strip from ${memory.author}`}
            sources={memory.booth.shots.map((shot) => ({
              position: shot.position,
              url: shot.url,
            }))}
          />
          <p className="text-sm text-foreground/70">
            {themeBundle(memory.booth.theme).label} ·{" "}
            {layoutLabel(memory.booth.frameLayout)} ·{" "}
            {filterLabel(memory.booth.filterId)}
          </p>
        </div>
      ) : memory.kind === "photo-strip" ? (
        <p className="text-base leading-7">Photo booth strip</p>
      ) : null}
      {memory.photoUrl ? (
        // Signed Storage URL. The optimizer would fetch and cache it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={memory.photoUrl}
          alt={memory.body?.trim() || `Photo from ${memory.author}`}
          referrerPolicy="no-referrer"
          className="max-h-96 w-full rounded-2xl object-cover"
          onError={() => {
            if (!memory.photoUrl || refreshedUrl.current === memory.photoUrl) {
              return;
            }
            refreshedUrl.current = memory.photoUrl;
            router.refresh();
          }}
        />
      ) : null}
      {memory.kind === "milestone" ? (
        <div>
          <p className="font-serif text-2xl tracking-tight">Still Us</p>
          {memory.body ? (
            <p className="mt-2 text-base leading-7">{memory.body}</p>
          ) : null}
        </div>
      ) : memory.kind === "letter" ? (
        <div>
          <p className="font-serif text-2xl tracking-tight">Opened letter</p>
          {memory.body ? (
            <p className="mt-2 text-base leading-7">{memory.body}</p>
          ) : null}
          {memory.letterId ? (
            <a
              href={`#letter-${memory.letterId}`}
              className="mt-3 inline-block text-sm font-medium text-pine"
            >
              Read the letter
            </a>
          ) : null}
        </div>
      ) : memory.body ? (
        <p className="text-base leading-7 whitespace-pre-wrap">{memory.body}</p>
      ) : null}
      {memory.tags.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Tags on this memory">
          {memory.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full border border-line px-3 py-1 text-sm"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
      {memory.mine && memory.kind !== "milestone" ? (
        <form action={formAction}>
          <input type="hidden" name="circleId" value={circleId} />
          <input type="hidden" name="id" value={memory.id} />
          {state.error ? (
            <p className="mb-2 text-sm text-accent" role="alert">
              {state.error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            aria-label={`Remove ${label}`}
            className="text-sm font-medium text-foreground/70 underline decoration-foreground/30"
          >
            {pending ? "Removing…" : "Remove"}
          </button>
        </form>
      ) : null}
    </li>
  );
}

function stripDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(
    new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    ),
  );
}

function TagButton({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`h-10 rounded-full border px-4 text-sm font-medium ${
        pressed
          ? "border-pine bg-pine text-white"
          : "border-line bg-card text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

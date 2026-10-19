"use client";

import {
  useActionState,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import {
  removeProfilePhoto,
  updateProfile,
  type ProfileFormState,
} from "@/app/profile/actions";
import { Camera } from "lucide-react";

import { ProfileAvatar } from "@/components/profile-avatar";
import { InfoTip } from "@/components/info-tip";
import { prepareBrowserImage } from "@/lib/memories/prepare-photo";
import {
  AVATAR_ERROR,
  AVATAR_MAX_BYTES,
  browserTimeZone,
  sniffAvatar,
  supportedTimeZones,
} from "@/lib/profile/fields";
import { friendlyZoneLabel } from "@/lib/time/zones";

const initialState: ProfileFormState = { error: null, savedAt: null };

function subscribeNoop() {
  return () => {};
}

export function ProfileForm({
  displayName: storedName,
  timezone: storedTimezone,
  avatarUrl,
  hasAvatar,
}: {
  displayName: string;
  timezone: string;
  avatarUrl: string | null;
  hasAvatar: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateProfile,
    initialState,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeProfilePhoto,
    initialState,
  );
  const browserZone = useSyncExternalStore(
    subscribeNoop,
    browserTimeZone,
    () => null,
  );
  const zonesReady = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const [displayName, setDisplayName] = useState(storedName);
  const [seenName, setSeenName] = useState(storedName);
  const [pickedTimezone, setPickedTimezone] = useState<string | null>(null);
  const [seenTimezone, setSeenTimezone] = useState(storedTimezone);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [seenSavedAt, setSeenSavedAt] = useState<number | null>(null);

  if (storedName !== seenName) {
    setSeenName(storedName);
    setDisplayName(storedName);
  }
  if (storedTimezone !== seenTimezone) {
    setSeenTimezone(storedTimezone);
    setPickedTimezone(null);
  }

  const savedAt =
    state.savedAt === null
      ? removeState.savedAt
      : removeState.savedAt === null
        ? state.savedAt
        : Math.max(state.savedAt, removeState.savedAt);
  if (savedAt !== seenSavedAt) {
    setSeenSavedAt(savedAt);
    if (savedAt !== null) {
      setPreview(null);
      setFileKey((key) => key + 1);
    }
  }

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function onAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0] ?? null;
    if (!file) {
      setFileError(null);
      setPreview(null);
      return;
    }
    // slice() so the sniff does not read the File the form will submit.
    // Some phones hand back HEIC. Draw that to a JPEG before the check.
    const prepared = await prepareBrowserImage(
      file,
      AVATAR_MAX_BYTES,
      AVATAR_ERROR,
    );
    if (!prepared.ok) {
      setFileError(prepared.error);
      setPreview(null);
      setFileKey((key) => key + 1);
      return;
    }
    if (prepared.file !== file) {
      const transfer = new DataTransfer();
      transfer.items.add(prepared.file);
      input.files = transfer.files;
    }
    const sniffed = sniffAvatar(
      new Uint8Array(await prepared.file.slice(0).arrayBuffer()),
    );
    if (!sniffed.ok) {
      setFileError(sniffed.error);
      setPreview(null);
      setFileKey((key) => key + 1);
      return;
    }
    setFileError(null);
    setPreview(URL.createObjectURL(prepared.file));
  }

  // Google sign-in leaves the column at UTC. Magic-link sign-in already stored
  // the browser zone. Fill the field only while the person has not picked one
  // and the saved value is still the default. The server snapshot is null, so
  // the first render matches the server and the browser zone arrives after.
  const detectedTimezone =
    pickedTimezone === null &&
    browserZone &&
    storedTimezone === "UTC" &&
    browserZone !== "UTC"
      ? browserZone
      : null;
  const timezone = pickedTimezone ?? detectedTimezone ?? storedTimezone;
  const zoneList = zonesReady ? supportedTimeZones() : [timezone];
  const options = zoneList.includes(timezone)
    ? zoneList
    : [timezone, ...zoneList];
  const shownUrl = preview ?? avatarUrl;
  const detectedNote =
    browserZone !== null &&
    timezone === browserZone &&
    timezone !== storedTimezone
      ? `This browser is in ${browserZone}. Save to store it on your profile.`
      : null;

  return (
    <>
      <form id="remove-photo" action={removeAction} hidden />
      <form action={formAction} className="flex max-w-xl flex-col gap-6">
        {state.error ? (
          <p
            className="rounded-2xl border border-line bg-card px-4 py-3 text-sm leading-6"
            role="alert"
          >
            {state.error}
          </p>
        ) : null}
        {state.savedAt !== null || removeState.savedAt !== null ? (
          <p
            className="rounded-2xl border border-line bg-card px-4 py-3 text-sm leading-6"
            role="status"
          >
            Saved.
          </p>
        ) : null}
        {removeState.error ? (
          <p
            className="rounded-2xl border border-line bg-card px-4 py-3 text-sm leading-6"
            role="alert"
          >
            {removeState.error}
          </p>
        ) : null}
        {fileError ? (
          <p
            className="rounded-2xl border border-line bg-card px-4 py-3 text-sm leading-6"
            role="alert"
          >
            {fileError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <label htmlFor="avatar" className="avatar-button">
            <ProfileAvatar
              name={displayName || storedName}
              url={shownUrl}
              alt=""
              className="h-24 w-24 text-3xl"
            />
            <span className="camera-badge" aria-hidden="true">
              <Camera size={14} />
            </span>
            <span className="sr-only">Photo</span>
          </label>
          <input
            key={fileKey}
            id="avatar"
            name="avatar"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onAvatarChange}
            className="sr-only"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-1">
              <p className="text-sm font-bold">Photo</p>
              <InfoTip label="About your photo">
                JPEG, PNG, or WebP. Up to 2 MB. Stored privately and shown with
                a link that expires.
              </InfoTip>
            </div>
            {hasAvatar ? (
              <button
                type="submit"
                form="remove-photo"
                disabled={pending || removePending}
                className="btn-quiet"
              >
                {removePending ? "Removing…" : "Remove photo"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="display-name" className="text-sm font-medium">
            Display name
          </label>
          <input
            id="display-name"
            name="displayName"
            type="text"
            required
            maxLength={80}
            autoComplete="nickname"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="h-12 rounded-2xl border border-line bg-card px-4 text-base outline-none ring-pine/40 focus:ring-2"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="timezone" className="text-sm font-medium">
            Timezone
          </label>
          <select
            id="timezone"
            name="timezone"
            value={timezone}
            onChange={(event) => setPickedTimezone(event.target.value)}
            aria-describedby="timezone-help"
            className="h-12 rounded-2xl border border-line bg-card px-4 text-base outline-none ring-pine/40 focus:ring-2"
          >
            {options.map((zone) => (
              <option key={zone} value={zone}>
                {friendlyZoneLabel(zone)}
              </option>
            ))}
          </select>
          <p id="timezone-help" className="text-sm leading-6 text-muted">
            {detectedNote ?? "Letters and countdowns use this."}
          </p>
          {browserZone && timezone !== browserZone ? (
            <button
              type="button"
              onClick={() => setPickedTimezone(browserZone)}
              className="self-start text-sm font-medium text-pine underline decoration-pine/40"
            >
              Use this browser&apos;s timezone
            </button>
          ) : null}
        </div>

        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending || removePending}
          className="inline-flex h-12 items-center justify-center self-start rounded-full bg-accent px-6 text-sm font-medium text-accent-ink transition-opacity disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>
      </form>
    </>
  );
}

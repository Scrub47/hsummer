"use client";

import { Heart, House, Smile, Users } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createCircle, type CreateCircleState } from "@/app/circles/actions";
import { InfoTip } from "@/components/info-tip";
import { trackProductEvent } from "@/lib/analytics/client";
import { writeInviteToken } from "@/lib/circles/invite-token";

const initialState: CreateCircleState = {
  error: null,
  circleId: null,
  inviteId: null,
  token: null,
  expiresAt: null,
};

const kinds = [
  { value: "couple", label: "Couple", icon: Heart },
  { value: "group", label: "Group", icon: Users },
  { value: "family", label: "Family", icon: House },
  { value: "friends", label: "Friends", icon: Smile },
] as const;

export function CircleCreateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createCircle,
    initialState,
  );

  useEffect(() => {
    if (!state.token || !state.inviteId || !state.circleId) return;
    const selected = document.querySelector<HTMLInputElement>(
      'input[name="circleType"]:checked',
    );
    trackProductEvent("circle_created", { circle_type: selected?.value });
    writeInviteToken(state.inviteId, state.token);
    router.push(`/circles/${state.circleId}`);
  }, [router, state.circleId, state.inviteId, state.token]);

  return (
    <>
      <button
        type="button"
        className="btn"
        hidden={open}
        onClick={() => setOpen(true)}
      >
        Create a circle
      </button>
      {open ? (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-circle-title"
            className="sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 id="create-circle-title" className="text-xl font-bold">
                New circle
              </h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <form action={formAction} className="flex flex-col gap-4">
              <fieldset>
                <legend className="mb-2 text-sm font-bold">
                  Kind of circle
                </legend>
                <div className="choice-grid">
                  {kinds.map((kind) => {
                    const Icon = kind.icon;
                    return (
                      <label key={kind.value} className="choice-card">
                        <input
                          type="radio"
                          name="circleType"
                          value={kind.value}
                          defaultChecked={kind.value === "couple"}
                          className="sr-only"
                        />
                        <Icon aria-hidden="true" size={18} />
                        {kind.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1">
                  <label htmlFor="circle-name" className="text-sm font-bold">
                    Name{" "}
                    <span className="font-normal text-muted">(optional)</span>
                  </label>
                  <InfoTip label="How invites work">
                    A couple starts with you. That invite link works once. A
                    group, family, or friends link can be used until it expires,
                    or until you set a limit.
                  </InfoTip>
                </div>
                <input
                  id="circle-name"
                  name="name"
                  maxLength={80}
                  placeholder="Me & Summer"
                  autoComplete="off"
                  className="h-12 px-4 text-base"
                />
              </div>
              {state.error ? (
                <p className="text-sm leading-6" role="alert">
                  {state.error}
                </p>
              ) : null}
              <button type="submit" disabled={pending} className="btn">
                {pending ? "Creating…" : "Create a circle"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

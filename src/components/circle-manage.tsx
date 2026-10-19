import { InvitePanel } from "@/components/invite-panel";
import { LeaveCircleForm } from "@/components/leave-circle-form";
import { ProfileAvatar } from "@/components/profile-avatar";
import { RenameCircleForm } from "@/components/rename-circle-form";
import type { CircleStatus, CircleType } from "@/lib/circles/fields";
import type { CircleInviteView } from "@/lib/circles/load";
import { friendlyZoneLabel } from "@/lib/time/zones";

/**
 * People, the circle name, the invite, and leave. Only the circle home
 * renders this. Feature tabs do not.
 */
export function CircleManage({
  circleId,
  circleType,
  status,
  invite,
  inviteClosed,
  demo,
  name,
  selfId,
  members,
}: {
  circleId: string;
  circleType: CircleType;
  status: CircleStatus;
  invite: CircleInviteView | null;
  inviteClosed: boolean;
  demo: boolean;
  name: string | null;
  selfId: string;
  members: {
    userId: string;
    displayName: string;
    timezone: string;
    avatarUrl: string | null;
  }[];
}) {
  return (
    <div data-testid="circle-manage" className="flex flex-col gap-6">
      <section>
        <h2 className="font-serif text-2xl tracking-tight">People</h2>
        <ul className="mt-4 flex flex-col gap-3">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center gap-4 rounded-3xl border border-line bg-card px-4 py-3"
            >
              <ProfileAvatar
                name={member.displayName}
                url={member.avatarUrl}
                alt=""
                className="h-12 w-12 text-lg"
              />
              <span>
                <span className="block font-medium">
                  {member.displayName}
                  {member.userId === selfId ? " (you)" : ""}
                </span>
                <span className="mt-1 block text-sm text-muted">
                  {friendlyZoneLabel(member.timezone)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {demo ? null : <RenameCircleForm circleId={circleId} name={name} />}

      <InvitePanel
        circleId={circleId}
        circleType={circleType}
        status={status}
        invite={invite}
        closed={inviteClosed}
        demo={demo}
      />

      {demo ? null : <LeaveCircleForm circleId={circleId} />}
    </div>
  );
}

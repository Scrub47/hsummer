"use client";

/**
 * Recipient radios for a circle with more than one other person.
 * A couple, and any circle of two, does not render this.
 */
export function MemberChoice({
  people,
  name,
  includeEveryone,
  legend,
}: {
  people: { userId: string; displayName: string }[];
  name: string;
  includeEveryone?: boolean;
  legend: string;
}) {
  if (people.length <= 1) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      {people.map((person) => (
        <label key={person.userId} className="flex items-center gap-3 text-sm">
          <input type="radio" name={name} value={person.userId} required />
          {person.displayName}
        </label>
      ))}
      {includeEveryone ? (
        <label className="flex items-center gap-3 text-sm">
          <input type="radio" name={name} value="everyone" required />
          Everyone
        </label>
      ) : null}
    </fieldset>
  );
}

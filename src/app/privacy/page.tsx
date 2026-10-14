import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-10">
      <header>
        <Link href="/" className="font-serif text-xl tracking-tight">
          Hsummer
        </Link>
      </header>
      <main className="flex flex-col gap-6 py-10 text-base leading-7">
        <h1 className="font-serif text-4xl tracking-tight">Privacy</h1>
        <p className="text-foreground/80">
          This is a plain explanation for a small private beta. It is not a
          legal document and it is not legal advice.
        </p>
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl tracking-tight">What is stored</h2>
          <p>
            Your email lives in the login system (Supabase Auth), including if
            you use Google. The app does not put that email on your profile.
            People in your circle see the display name, timezone, and avatar you
            choose.
          </p>
          <p>
            Circle content stays in the database: the circle name, who is a
            member, invite use (the link itself is stored only as a hash),
            bucket-list items, moods, memory notes and photos, and Thinking of
            You gestures. If you turn on notifications, the browser&apos;s push
            address and its two encryption keys are stored so a gesture can
            reach that device.
          </p>
          <p>
            Sign-in and invite tries are counted by a hash of the network
            address and, for a magic link, a hash of the email. The raw address
            is not written down.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl tracking-tight">Who can see it</h2>
          <p>
            Circle members can see what that circle&apos;s rules allow. A
            selected memory is limited to the people you picked. A one-to-one
            gesture is the sender and the recipient. Photos sit in a private
            bucket and are opened with a short-lived link. There is no public
            feed.
          </p>
          <p>
            The developer who runs the project can access the database,
            including a weekly backup that is encrypted before it is stored.
            That backup is the copy used if the database has to be restored.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl tracking-tight">Where it lives</h2>
          <p>
            The site is hosted on Vercel. The database, login, and file storage
            are Supabase in Oregon (us-west-2). Optional rate-limit counts use
            Upstash Redis in us-west-2. Google receives the sign-in request when
            you choose Google. Push delivery is handled by your browser&apos;s
            push service (for example Apple, Google, or Mozilla).
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl tracking-tight">Children</h2>
          <p>
            Hsummer is not directed at anyone under 13, and it does not ask for
            a date of birth. If you believe a child&apos;s information is in the
            app, use the contact below.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl tracking-tight">
            How to ask a question
          </h2>
          <p>
            Write to Isaac Hsu, or use the private security contact on the
            security policy if the question is about a vulnerability. There is
            no separate company behind this beta.
          </p>
        </section>
      </main>
    </div>
  );
}

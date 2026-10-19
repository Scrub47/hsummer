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
            Hsummer is for people 13 and older. Sign-in asks you to confirm
            that. It does not ask for a date of birth. If you believe a
            child&apos;s information is in the app, use the contact below.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl tracking-tight">
            Leaving and deleting
          </h2>
          <p>
            You can download a ZIP of what you can already see, including the
            image files, before you leave a circle or delete your account. That
            download is not a backup of other people&apos;s private letters.
          </p>
          <p>
            Leaving a circle ends your access. The default keeps your photos,
            notes, and letters there. You can remove those instead. Deleting
            your account removes the login, the profile, the avatar files, and
            the push subscriptions. Shared contributions stay labeled Former
            member unless you remove them. A circle with nobody left is deleted
            after 30 days.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl tracking-tight">Usage numbers</h2>
          <p>
            When product analytics is turned on, the site can count visits and a
            short list of actions: a circle created, a letter sent, a ping, a
            mood, a photo, a memory. It does not send letter text, names,
            photos, or your email. The count is tied to your account id only.
            Settings, under Privacy, has a switch that stops it immediately.
            With the analytics key unset, none of that code loads.
          </p>
          <p>
            Vercel can also count page views and page speed for the site as a
            whole. That count is not tied to your name or email.
          </p>
          <p>
            Feedback you send from Settings is a rating and an optional note. It
            is stored so Isaac can read it. People in your circles cannot see
            it, and you cannot read it back from the app.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl tracking-tight">The demo</h2>
          <p>
            Try demo signs you into a fictional couple, Alex and Jordan. It is
            not real user data. Uploads and notifications are off, and the
            circle is rebuilt every night.
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

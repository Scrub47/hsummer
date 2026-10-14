import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms",
};

export default function TermsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-10">
      <header>
        <Link href="/" className="font-serif text-xl tracking-tight">
          Hsummer
        </Link>
      </header>
      <main className="flex flex-col gap-6 py-10 text-base leading-7">
        <h1 className="font-serif text-4xl tracking-tight">Terms</h1>
        <p className="text-foreground/80">
          This is a plain explanation for a small private beta. It is not a
          contract drafted by a lawyer and it is not legal advice.
        </p>
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl tracking-tight">The beta</h2>
          <p>
            Hsummer is a private shared space for people who already know each
            other. It can break, change, or go away. Do not rely on it as the
            only copy of something you cannot lose. There is no payment and no
            support desk.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl tracking-tight">Your content</h2>
          <p>
            You keep what you write and the photos you upload. By putting
            something in a circle, you let the people that circle&apos;s
            visibility allows see it. Don&apos;t post someone else&apos;s
            private information, and don&apos;t use the app to harass anyone.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl tracking-tight">Accounts</h2>
          <p>
            Sign-in is Google or an email link. There is no password. You are
            responsible for the email account you use. Invite links are for the
            person you meant to invite; if one leaks, make a new link, which
            turns the old one off.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl tracking-tight">Stopping</h2>
          <p>
            You can stop using Hsummer at any time. The person running the
            project can remove an account or a circle that is being used to harm
            someone. The{" "}
            <Link href="/privacy" className="underline decoration-pine/40">
              privacy page
            </Link>{" "}
            says what is stored.
          </p>
        </section>
      </main>
    </div>
  );
}

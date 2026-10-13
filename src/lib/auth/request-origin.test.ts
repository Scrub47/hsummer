import { describe, expect, it } from "vitest";

import { redirectOrigin } from "@/lib/auth/request-origin";

function request(url: string, host: string | null) {
  return {
    url,
    headers: {
      get(name: string) {
        return name.toLowerCase() === "host" ? host : null;
      },
    },
  };
}

describe("redirectOrigin", () => {
  it("follows the browser when it opened 127.0.0.1 and Next rewrote the URL to localhost", () => {
    expect(
      redirectOrigin(
        request("http://localhost:3000/api/test/sign-in", "127.0.0.1:3000"),
      ),
    ).toBe("http://127.0.0.1:3000");
  });

  it("keeps localhost when that is the host the browser used", () => {
    expect(
      redirectOrigin(
        request("http://localhost:3000/auth/callback", "localhost:3000"),
      ),
    ).toBe("http://localhost:3000");
  });

  it("keeps a bracketed IPv6 loopback host", () => {
    expect(
      redirectOrigin(request("http://localhost:3000/home", "[::1]:3000")),
    ).toBe("http://[::1]:3000");
  });

  it("ignores a public host and uses the request URL", () => {
    expect(
      redirectOrigin(
        request(
          "https://hsummer.vercel.app/auth/callback?next=/home",
          "hsummer.vercel.app",
        ),
      ),
    ).toBe("https://hsummer.vercel.app");
  });

  it("ignores a host that only looks like loopback", () => {
    expect(
      redirectOrigin(
        request(
          "https://hsummer.vercel.app/auth/callback",
          "127.0.0.1.evil.com",
        ),
      ),
    ).toBe("https://hsummer.vercel.app");
  });

  it("ignores a host with a user, query, or extra comma", () => {
    const url = "https://hsummer.vercel.app/auth/callback";
    expect(redirectOrigin(request(url, "user:pass@127.0.0.1:3000"))).toBe(
      "https://hsummer.vercel.app",
    );
    expect(
      redirectOrigin(request(url, "127.0.0.1:3000?next=https://evil.test")),
    ).toBe("https://hsummer.vercel.app");
    expect(redirectOrigin(request(url, "127.0.0.1:3000, evil.test"))).toBe(
      "https://hsummer.vercel.app",
    );
  });

  it("uses the request URL when Host is missing", () => {
    expect(
      redirectOrigin(request("https://hsummer.vercel.app/home", null)),
    ).toBe("https://hsummer.vercel.app");
  });
});

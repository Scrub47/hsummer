import { describe, expect, it } from "vitest";

import { analyticsInitOptions } from "@/lib/analytics/config";
import {
  DEFAULT_POSTHOG_HOST,
  posthogApiHost,
  posthogAssetHost,
  posthogKeyConfigured,
  posthogRewrites,
} from "@/lib/analytics/hosts";

describe("posthog hosts", () => {
  it("accepts a real project key and rejects placeholders", () => {
    expect(posthogKeyConfigured(undefined)).toBe(false);
    expect(posthogKeyConfigured("your-posthog-key")).toBe(false);
    expect(posthogKeyConfigured("phc_your_project_key")).toBe(false);
    expect(posthogKeyConfigured("phc_example_project_key")).toBe(true);
  });

  it("defaults an empty or placeholder host to the US cloud", () => {
    expect(posthogApiHost(undefined)).toBe(DEFAULT_POSTHOG_HOST);
    expect(posthogApiHost("")).toBe(DEFAULT_POSTHOG_HOST);
    expect(posthogApiHost("https://your-posthog-host.example")).toBe(
      DEFAULT_POSTHOG_HOST,
    );
    expect(posthogApiHost("http://eu.i.posthog.com")).toBe(
      DEFAULT_POSTHOG_HOST,
    );
    expect(posthogApiHost("https://eu.i.posthog.com/ingest")).toBe(
      "https://eu.i.posthog.com",
    );
  });

  it("rewrites /ingest to the API and /ingest/static to the asset host", () => {
    expect(posthogAssetHost("https://us.i.posthog.com")).toBe(
      "https://us-assets.i.posthog.com",
    );
    expect(posthogRewrites(undefined)).toEqual([
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ]);
  });
});

describe("posthog init", () => {
  it("turns off replay, autocapture, and external scripts", () => {
    const options = analyticsInitOptions("https://us.i.posthog.com");
    expect(options.api_host).toBe("/ingest");
    expect(options.ui_host).toBe("https://us.posthog.com");
    expect(options.autocapture).toBe(false);
    expect(options.disable_session_recording).toBe(true);
    expect(options.session_recording.maskAllInputs).toBe(true);
    expect(options.session_recording.maskTextSelector).toBe("*");
    expect(options.mask_all_text).toBe(true);
    expect(options.disable_external_dependency_loading).toBe(true);
    expect(options.person_profiles).toBe("identified_only");
    expect(options.capture_pageview).toBe("history_change");
  });
});

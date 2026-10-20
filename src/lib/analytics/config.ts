import { posthogUiHost } from "@/lib/analytics/hosts";

/**
 * PostHog init for the browser. Session replay stays off, autocapture of
 * text and inputs stays off, and every request goes to `/ingest` so the
 * Content-Security-Policy does not need a PostHog origin.
 */
export function analyticsInitOptions(apiHost: string) {
  return {
    api_host: "/ingest",
    ui_host: posthogUiHost(apiHost),
    autocapture: false,
    capture_pageview: "history_change" as const,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_external_dependency_loading: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
    },
    mask_all_text: true,
    mask_all_element_attributes: true,
    mask_personal_data_properties: true,
    person_profiles: "identified_only" as const,
    advanced_disable_feature_flags: true,
    rageclick: false,
    capture_dead_clicks: false,
    persistence: "localStorage+cookie" as const,
  };
}

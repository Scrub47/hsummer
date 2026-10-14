"use client";

import { useEffect, useState } from "react";

import { isCircleId } from "@/lib/bucket/fields";
import { getSupabaseBrowserConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

/**
 * Refreshes the page when another member changes this circle's rows.
 *
 * The socket has to join with the signed-in access token. Joining first as
 * the anonymous key accepts the channel and then drops every change.
 */
export function useCircleLive(
  circleId: string,
  table: "bucket_items" | "current_moods",
  onChange: () => void,
): "connecting" | "live" | "off" {
  const configured =
    isCircleId(circleId) && getSupabaseBrowserConfig() !== null;
  const [live, setLive] = useState<"connecting" | "live" | "off">("connecting");

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    if (!supabase) return;

    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const timer = setTimeout(() => {
      if (active) {
        setLive((current) => (current === "connecting" ? "off" : current));
      }
    }, 8000);

    void supabase.auth
      .getSession()
      .then(async ({ data }) => {
        const token = data.session?.access_token;
        if (!active) return;
        if (!token) {
          setLive("off");
          return;
        }
        await supabase.realtime.setAuth(token);
        if (!active) return;

        channel = supabase
          .channel(`${table}:${circleId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table,
              filter: `circle_id=eq.${circleId}`,
            },
            () => {
              onChange();
            },
          )
          .subscribe((status) => {
            if (!active) return;
            if (status === "SUBSCRIBED") setLive("live");
            if (
              status === "CHANNEL_ERROR" ||
              status === "TIMED_OUT" ||
              status === "CLOSED"
            ) {
              setLive("off");
            }
          });
      })
      .catch(() => {
        if (active) setLive("off");
      });

    return () => {
      active = false;
      clearTimeout(timer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [circleId, configured, onChange, table]);

  if (!configured) return "off";
  return live;
}

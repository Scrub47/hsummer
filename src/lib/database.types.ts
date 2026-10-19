/**
 * Hand-written slice of the generated Supabase types.
 *
 * Profiles, account settings, circles, invites, pings, the bucket list,
 * current moods, the memory wall, letters, and push subscriptions live here. When the
 * schema grows, replace this file with
 * `supabase gen types typescript`. `circle_invites.token_hash` is omitted:
 * authenticated clients are not granted that column. Pings have no client
 * update or delete grant; the Update shape is only what a test may attempt.
 * Bucket-list Insert and Update include columns the app does not send. Those
 * are what a test may attempt; the trigger and the column grants reject them.
 * `circle_invites.created_at` is on Update only so a test can move a row out
 * of the rate-limit window. Authenticated clients have no update grant.
 */
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_path: string | null;
          timezone: string;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          avatar_path?: string | null;
          timezone?: string;
          created_at?: string;
        };
        Update: {
          display_name?: string;
          avatar_path?: string | null;
          timezone?: string;
        };
        Relationships: [];
      };
      account_private: {
        Row: {
          user_id: string;
          age_confirmed_at: string | null;
          notification_prefs: Record<string, boolean>;
          is_demo: boolean;
          created_at: string;
        };
        Insert: {
          user_id: string;
          age_confirmed_at?: string | null;
          notification_prefs?: Record<string, boolean>;
          is_demo?: boolean;
          created_at?: string;
        };
        Update: {
          age_confirmed_at?: string | null;
          notification_prefs?: Record<string, boolean>;
        };
        Relationships: [];
      };
      circles: {
        Row: {
          id: string;
          name: string | null;
          circle_type: "couple" | "group" | "family" | "friends";
          created_by: string | null;
          created_at: string;
          status: "pending" | "active" | "archived";
          archived_at: string | null;
          is_demo: boolean;
        };
        Insert: {
          id?: string;
          name?: string | null;
          circle_type: "couple" | "group" | "family" | "friends";
          created_by?: string | null;
          created_at?: string;
          status?: "pending" | "active" | "archived";
          archived_at?: string | null;
          is_demo?: boolean;
        };
        Update: {
          name?: string | null;
        };
        Relationships: [];
      };
      circle_members: {
        Row: {
          circle_id: string;
          user_id: string;
          joined_at: string;
          left_at: string | null;
          muted_until: string | null;
        };
        Insert: {
          circle_id: string;
          user_id: string;
          joined_at?: string;
          left_at?: string | null;
          muted_until?: string | null;
        };
        Update: {
          left_at?: string | null;
          muted_until?: string | null;
        };
        Relationships: [];
      };
      circle_invites: {
        Row: {
          id: string;
          circle_id: string;
          created_by: string | null;
          created_at: string;
          expires_at: string;
          max_uses: number | null;
          use_count: number;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          circle_id: string;
          created_by?: string | null;
          created_at?: string;
          expires_at: string;
          max_uses?: number | null;
          use_count?: number;
          revoked_at?: string | null;
        };
        Update: {
          expires_at?: string;
          revoked_at?: string | null;
          use_count?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      circle_invite_redemptions: {
        Row: {
          invite_id: string;
          user_id: string;
          redeemed_at: string;
        };
        Insert: {
          invite_id: string;
          user_id: string;
          redeemed_at?: string;
        };
        Update: {
          redeemed_at?: string;
        };
        Relationships: [];
      };
      pings: {
        Row: {
          id: string;
          circle_id: string;
          from_user_id: string | null;
          to_user_id: string | null;
          ping_type: "thinking-of-you" | "mood-share";
          mood_emoji: string | null;
          secret_variant: boolean;
          sent_at: string;
        };
        Insert: {
          id?: string;
          circle_id: string;
          from_user_id?: string | null;
          to_user_id?: string | null;
          ping_type?: "thinking-of-you" | "mood-share";
          mood_emoji?: string | null;
          secret_variant?: boolean;
          sent_at?: string;
        };
        Update: {
          secret_variant?: boolean;
          sent_at?: string;
        };
        Relationships: [];
      };
      bucket_items: {
        Row: {
          id: string;
          circle_id: string;
          created_by: string | null;
          title: string;
          category:
            "restaurant" | "movie" | "activity" | "date-idea" | "ldr-idea";
          status: "idea" | "planned" | "done";
          planned_date: string | null;
          completed_at: string | null;
          notes: string | null;
          link: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          circle_id: string;
          created_by?: string | null;
          title: string;
          category:
            "restaurant" | "movie" | "activity" | "date-idea" | "ldr-idea";
          status?: "idea" | "planned" | "done";
          planned_date?: string | null;
          completed_at?: string | null;
          notes?: string | null;
          link?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          category?:
            "restaurant" | "movie" | "activity" | "date-idea" | "ldr-idea";
          status?: "idea" | "planned" | "done";
          planned_date?: string | null;
          notes?: string | null;
          link?: string | null;
          circle_id?: string;
          created_by?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      current_moods: {
        Row: {
          user_id: string;
          circle_id: string;
          emoji: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          circle_id: string;
          emoji: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          circle_id?: string;
          emoji?: string;
        };
        Relationships: [];
      };
      memories: {
        Row: {
          id: string;
          circle_id: string;
          created_by: string | null;
          kind: "photo" | "note" | "letter" | "milestone" | "photo-strip";
          body: string | null;
          photo_path: string | null;
          photo_bytes: number;
          tags: string[];
          visibility: "circle" | "selected";
          occurred_on: string;
          letter_id: string | null;
          checkpoint_id: string | null;
          booth_session_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          circle_id: string;
          created_by?: string | null;
          kind: "photo" | "note" | "letter" | "milestone" | "photo-strip";
          body?: string | null;
          photo_path?: string | null;
          photo_bytes?: number;
          tags?: string[];
          visibility?: "circle" | "selected";
          occurred_on?: string;
          letter_id?: string | null;
          checkpoint_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          body?: string | null;
          tags?: string[];
          visibility?: "circle" | "selected";
          occurred_on?: string;
          circle_id?: string;
          kind?: "photo" | "note" | "letter" | "milestone" | "photo-strip";
          photo_path?: string | null;
          photo_bytes?: number;
          created_by?: string | null;
          created_at?: string;
          letter_id?: string | null;
          checkpoint_id?: string | null;
          booth_session_id?: string | null;
        };
        Relationships: [];
      };
      booth_sessions: {
        Row: {
          id: string;
          circle_id: string;
          created_by: string | null;
          mode: "solo" | "pass" | "together";
          theme: "kawaii" | "minimal";
          frame_layout: "4-cut" | "2-cut";
          status:
            | "open"
            | "ready"
            | "capturing"
            | "complete"
            | "cancelled"
            | "expired";
          capture_at: string | null;
          expires_at: string | null;
          caption: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          circle_id: string;
          created_by?: string | null;
          mode: "solo" | "pass" | "together";
          theme: "kawaii" | "minimal";
          frame_layout: "4-cut" | "2-cut";
          status?:
            | "open"
            | "ready"
            | "capturing"
            | "complete"
            | "cancelled"
            | "expired";
          capture_at?: string | null;
          expires_at?: string | null;
          created_at?: string;
        };
        Update: {
          mode?: "solo" | "pass" | "together";
          theme?: "kawaii" | "minimal";
          status?:
            | "open"
            | "ready"
            | "capturing"
            | "complete"
            | "cancelled"
            | "expired";
          // Not granted to authenticated. Present so a test can try to move it.
          expires_at?: string | null;
          caption?: string | null;
        };
        Relationships: [];
      };
      booth_contributors: {
        Row: {
          session_id: string;
          user_id: string;
          assigned_positions: number[];
          filter_id: "none" | "bw" | "sepia" | "warm" | "cool" | "grain";
          ready_at: string | null;
        };
        Insert: {
          session_id: string;
          user_id: string;
          assigned_positions: number[];
          filter_id?: "none" | "bw" | "sepia" | "warm" | "cool" | "grain";
          ready_at?: string | null;
        };
        Update: {
          assigned_positions?: number[];
          filter_id?: "none" | "bw" | "sepia" | "warm" | "cool" | "grain";
          ready_at?: string | null;
        };
        Relationships: [];
      };
      circle_push_windows: {
        Row: {
          circle_id: string;
          user_id: string;
          last_sent_at: string | null;
          held_count: number;
        };
        Insert: {
          circle_id: string;
          user_id: string;
          last_sent_at?: string | null;
          held_count?: number;
        };
        Update: {
          last_sent_at?: string | null;
          held_count?: number;
        };
        Relationships: [];
      };
      booth_clock_samples: {
        Row: {
          id: string;
          session_id: string;
          user_id: string;
          offset_ms: number;
          rtt_ms: number;
          recorded_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          user_id: string;
          offset_ms: number;
          rtt_ms: number;
          recorded_at?: string;
        };
        Update: {
          offset_ms?: number;
          rtt_ms?: number;
        };
        Relationships: [];
      };
      booth_shots: {
        Row: {
          session_id: string;
          user_id: string | null;
          position: number;
          storage_path: string;
          byte_size: number;
        };
        Insert: {
          session_id: string;
          user_id?: string | null;
          position: number;
          storage_path: string;
          byte_size: number;
        };
        Update: {
          storage_path?: string;
          byte_size?: number;
        };
        Relationships: [];
      };
      memory_viewers: {
        Row: {
          memory_id: string;
          circle_id: string;
          user_id: string;
        };
        Insert: {
          memory_id: string;
          circle_id: string;
          user_id: string;
        };
        Update: {
          memory_id?: string;
          circle_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      letter_categories: {
        Row: {
          id: string;
          circle_id: string;
          label: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          circle_id: string;
          label: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          label?: string;
        };
        Relationships: [];
      };
      letters: {
        Row: {
          id: string;
          circle_id: string;
          from_user_id: string | null;
          to_user_id: string | null;
          category: string;
          title: string | null;
          body: string;
          design: "minimal" | "kawaii" | "retro-film";
          scheduled_for: string | null;
          status: "scheduled" | "delivered" | "cancelled";
          delivered_at: string | null;
          opened_at: string | null;
          created_at: string;
          // Not granted to authenticated on select. The secret key reads it
          // to cancel a QStash message. A signed-in select of this column fails.
          qstash_message_id?: string | null;
        };
        Insert: {
          id?: string;
          circle_id: string;
          from_user_id?: string | null;
          to_user_id?: string | null;
          category: string;
          title?: string | null;
          body: string;
          design?: "minimal" | "kawaii" | "retro-film";
          // Granted. A future instant stays scheduled. A past instant is refused.
          scheduled_for?: string | null;
          status?: "scheduled" | "delivered" | "cancelled";
          delivered_at?: string | null;
          opened_at?: string | null;
          qstash_message_id?: string | null;
        };
        Update: {
          category?: string;
          title?: string | null;
          body?: string;
          design?: "minimal" | "kawaii" | "retro-film";
          status?: "scheduled" | "delivered" | "cancelled";
          // Not granted. Present so a test can try to move them.
          delivered_at?: string | null;
          opened_at?: string | null;
          to_user_id?: string | null;
          from_user_id?: string | null;
          scheduled_for?: string | null;
          qstash_message_id?: string | null;
        };
        Relationships: [];
      };
      countdowns: {
        Row: {
          id: string;
          circle_id: string;
          label: string;
          target_date: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          circle_id: string;
          label?: string;
          target_date?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          label?: string;
          target_date?: string | null;
        };
        Relationships: [];
      };
      checkpoints: {
        Row: {
          id: string;
          countdown_id: string;
          circle_id: string;
          label: string;
          date: string;
          trigger: "auto-by-date" | "manual";
          hit_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          countdown_id: string;
          circle_id: string;
          label: string;
          date: string;
          trigger: "auto-by-date" | "manual";
          created_by?: string | null;
          created_at?: string;
          // Not granted. Present so a test can try.
          hit_at?: string | null;
        };
        Update: {
          label?: string;
          date?: string;
          trigger?: "auto-by-date" | "manual";
          hit_at?: string | null;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at?: string;
        };
        Update: {
          // user_id is granted so the upsert can send it. The guard trigger
          // rejects a change. The type keeps it so a tamper test can try.
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_circle: {
        Args: { circle_name: string | null; circle_type: string };
        Returns: {
          circle_id: string;
          invite_id: string;
          token: string;
          expires_at: string;
        }[];
      };
      preview_invite: {
        Args: { raw_token: string };
        Returns: {
          circle_id: string | null;
          circle_name: string | null;
          circle_type: string | null;
          invite_state: string;
        }[];
      };
      redeem_invite: {
        Args: { raw_token: string; ip_hash: string };
        Returns: {
          invite_state: string;
          circle_id: string | null;
        }[];
      };
      regenerate_invite: {
        Args: { target_circle: string };
        Returns: {
          invite_id: string;
          token: string;
          expires_at: string;
        }[];
      };
      circle_memory_bytes: {
        Args: { target: string };
        Returns: number;
      };
      open_letter: {
        Args: { target: string };
        Returns: string;
      };
      deliver_scheduled_letter: {
        Args: { target: string };
        Returns: string;
      };
      deliver_due_letters: {
        Args: { target_circle: string };
        Returns: {
          letter_id: string;
          to_user_id: string;
        }[];
      };
      sync_auto_checkpoints: {
        Args: { target_circle: string };
        Returns: {
          memory_id: string;
          checkpoint_id: string;
        }[];
      };
      hit_checkpoint: {
        Args: { target: string };
        Returns: string;
      };
      save_solo_booth: {
        Args: {
          target_circle: string;
          target_theme: string;
          target_layout: string;
          target_filter: string;
          target_caption: string;
          shot_sizes: number[];
        };
        Returns: {
          session_id: string;
          memory_id: string;
          paths: string[];
        };
      };
      create_pass_booth: {
        Args: {
          target_circle: string;
          partner_id: string;
          target_theme: string;
          target_layout: string;
          target_filter: string;
          target_caption: string;
          shot_sizes: number[];
        };
        Returns: {
          session_id: string;
          positions: number[];
          paths: string[];
        };
      };
      submit_pass_shots: {
        Args: {
          target_session: string;
          target_filter: string;
          shot_sizes: number[];
        };
        Returns: {
          status: string;
          paths: string[];
          already: boolean;
        };
      };
      finish_pass_booth: {
        Args: { target_session: string };
        Returns: {
          status: string;
          memory_id: string | null;
        };
      };
      cancel_pass_booth: {
        Args: { target_session: string };
        Returns: { status: string };
      };
      discard_pass_booth: {
        Args: { target_session: string };
        Returns: { ok: boolean };
      };
      release_pass_shots: {
        Args: { target_session: string };
        Returns: { ok: boolean };
      };
      expire_pass_booths: {
        Args: { target_circle: string };
        Returns: number;
      };
      set_invite_max_uses: {
        Args: { target_circle: string; next_max: number | null };
        Returns: undefined;
      };
      create_pass_booth_picked: {
        Args: {
          target_circle: string;
          participant_ids: string[];
          target_theme: string;
          target_layout: string;
          target_filter: string;
          target_caption: string;
          shot_sizes: number[];
        };
        Returns: {
          session_id: string;
          positions: number[];
          paths: string[];
        };
      };
      open_together_booth: {
        Args: {
          target_circle: string;
          participant_ids: string[];
          target_theme: string;
          target_layout: string;
        };
        Returns: {
          session_id: string;
          positions: number[];
          expires_at: string;
        };
      };
      mark_together_ready: {
        Args: {
          target_session: string;
          offset_ms?: number | null;
          rtt_ms?: number | null;
        };
        Returns: {
          status: string;
          capture_at: string | null;
          expires_at: string | null;
          ready_ids: string[];
          waiting_ids: string[];
        };
      };
      submit_together_shots: {
        Args: {
          target_session: string;
          target_filter: string;
          shot_sizes: number[];
        };
        Returns: {
          status: string;
          paths: string[];
          already: boolean;
        };
      };
      finish_together_booth: {
        Args: { target_session: string };
        Returns: {
          status: string;
          memory_id: string | null;
          capture_at?: string | null;
          expires_at?: string | null;
          ready_ids?: string[];
          waiting_ids?: string[];
        };
      };
      cancel_together_booth: {
        Args: { target_session: string };
        Returns: { status: string };
      };
      fallback_together_to_pass: {
        Args: { target_session: string };
        Returns: { status: string };
      };
      expire_together_booths: {
        Args: { target_circle?: string | null };
        Returns: number;
      };
      release_together_shots: {
        Args: { target_session: string };
        Returns: { ok: boolean };
      };
      consume_auth_attempt: {
        Args: {
          attempt_bucket: string;
          attempt_limit: number;
          attempt_window: number;
        };
        Returns: boolean;
      };
      security_audit_gaps: {
        Args: Record<string, never>;
        Returns: {
          kind: string;
          object_name: string;
        }[];
      };
      leave_circle: {
        Args: { target_circle: string; remove_content: boolean };
        Returns: { message_id: string | null }[];
      };
      delete_own_account: {
        Args: { remove_content: boolean };
        Returns: { message_id: string | null }[];
      };
      purge_archived_circles: {
        Args: Record<string, never>;
        Returns: number;
      };
      purge_expired_pings: {
        Args: { cutoff: string };
        Returns: number;
      };
      sweep_quiet_circles: {
        Args: Record<string, never>;
        Returns: number;
      };
      seed_demo_circle: {
        Args: { photo_bytes: number };
        Returns: {
          circleId: string;
          photoPath: string;
          boothPaths: string[];
        };
      };
    };
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type AccountPrivate =
  Database["public"]["Tables"]["account_private"]["Row"];
export type PushSubscriptionRow =
  Database["public"]["Tables"]["push_subscriptions"]["Row"];

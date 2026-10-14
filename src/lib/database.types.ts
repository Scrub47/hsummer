/**
 * Hand-written slice of the generated Supabase types.
 *
 * Profiles, account settings, circles, invites, pings, the bucket list,
 * current moods, and push subscriptions live here. When the schema grows,
 * replace this file with
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
          created_at: string;
        };
        Insert: {
          user_id: string;
          age_confirmed_at?: string | null;
          notification_prefs?: Record<string, boolean>;
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
        };
        Insert: {
          id?: string;
          name?: string | null;
          circle_type: "couple" | "group" | "family" | "friends";
          created_by?: string | null;
          created_at?: string;
          status?: "pending" | "active" | "archived";
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
    };
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type AccountPrivate =
  Database["public"]["Tables"]["account_private"]["Row"];
export type PushSubscriptionRow =
  Database["public"]["Tables"]["push_subscriptions"]["Row"];

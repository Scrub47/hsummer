/**
 * Hand-written slice of the generated Supabase types.
 *
 * Profiles, account_private, and push subscriptions live here. When the
 * schema grows, replace this file with `supabase gen types typescript`.
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
    Functions: Record<string, never>;
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type AccountPrivate =
  Database["public"]["Tables"]["account_private"]["Row"];
export type PushSubscriptionRow =
  Database["public"]["Tables"]["push_subscriptions"]["Row"];

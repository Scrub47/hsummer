/**
 * Hand-written slice of the generated Supabase types.
 *
 * Only the week-1 tables live here. When the schema grows, replace this file
 * with the output of `supabase gen types typescript` so it cannot drift.
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
export type PushSubscriptionRow =
  Database["public"]["Tables"]["push_subscriptions"]["Row"];

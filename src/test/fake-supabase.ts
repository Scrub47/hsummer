import type { Session } from "@/lib/supabase/session";

type QueryResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

export function queryResult(
  data: unknown,
  error: QueryResult["error"] = null,
): QueryResult {
  return { data, error };
}

function chain(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  for (const method of ["select", "eq", "is", "in", "order", "limit"]) {
    builder[method] = self;
  }
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

/**
 * Enough of a Supabase client for the loaders. Each table returns one canned
 * result. A signed URL is optional and is only used when a loader asks
 * Storage for one.
 */
export function fakeSession(input: {
  userId: string;
  tables: Record<string, QueryResult>;
  signedUrl?: {
    signedUrl: string | null;
    error: { message: string } | null;
  };
  onSignedUrl?: (input: { path: string; expiresIn: number }) => void;
  rpc?: QueryResult;
}): Session {
  return {
    userId: input.userId,
    supabase: {
      from(table: string) {
        const result = input.tables[table];
        if (!result) throw new Error(`unexpected table ${table}`);
        return chain(result);
      },
      rpc: async () => input.rpc ?? queryResult(0),
      storage: {
        from() {
          return {
            createSignedUrl: async (path: string, expiresIn: number) => {
              input.onSignedUrl?.({ path, expiresIn });
              const signed = input.signedUrl ?? {
                signedUrl: null,
                error: { message: "no signed url" },
              };
              return {
                data: signed.signedUrl ? { signedUrl: signed.signedUrl } : null,
                error: signed.error,
              };
            },
          };
        },
      },
    } as unknown as Session["supabase"],
  };
}

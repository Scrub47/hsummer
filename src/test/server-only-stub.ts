// Vitest runs in Node, where the real `server-only` package throws.
// Next.js swaps that package out for an empty module in server builds.
export {};

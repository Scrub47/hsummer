/**
 * Prints a VAPID key pair for .env.local. Equivalent to:
 *   npx web-push generate-vapid-keys
 *
 * The private key is a secret. Do not commit it.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const webpush = require("web-push");
const keys = webpush.generateVAPIDKeys();

console.log("Add these to .env.local (and to Vercel). Do not commit them.\n");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
console.log(
  "\nChange VAPID_SUBJECT to a real mailto: or https: contact before sending pushes.",
);

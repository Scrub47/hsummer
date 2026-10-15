/**
 * The 13+ confirmation travels in a short-lived cookie from the sign-in
 * form to the auth callback, which writes account_private.age_confirmed_at.
 * The cookie is not the record. The column is.
 */

export const AGE_COOKIE = "hsummer_age";
export const AGE_COOKIE_MAX_AGE = 60 * 60;

export function ageCookieOptions(https: boolean): {
  httpOnly: true;
  sameSite: "lax";
  path: string;
  maxAge: number;
  secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: AGE_COOKIE_MAX_AGE,
    secure: https,
  };
}

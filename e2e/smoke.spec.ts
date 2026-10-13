import { expect, test } from "@playwright/test";

test("landing page shows the name, tagline, and sign-in link", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hsummer" })).toBeVisible();
  await expect(
    page.getByText(
      /made for couples, built for groups, friends, and families/i,
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("sign-in offers Google and a magic link without real credentials", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/isn't configured/i);

  await page.getByLabel("Email").fill("summer@example.com");
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /isn't configured/i }),
  ).toBeVisible();
});

test("the signed-in home redirects to sign-in when there is no session", async ({
  page,
}) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fhome$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("the profile page redirects to sign-in when there is no session", async ({
  page,
}) => {
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fprofile$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("circles redirect to sign-in when there is no session", async ({
  page,
}) => {
  await page.goto("/circles");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fcircles$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("an invite link explains that sign-in comes before joining", async ({
  page,
}) => {
  await page.goto("/join/not-a-real-token");
  await expect(
    page.getByRole("heading", { name: "Join a circle" }),
  ).toBeVisible();
  await expect(page.getByText(/isn't valid/i)).toBeVisible();
});

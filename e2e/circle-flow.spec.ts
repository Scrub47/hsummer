import { expect, test, type Page } from "@playwright/test";

/**
 * Sign in, create a couple circle, invite, join, and send Thinking of You.
 *
 * Auth is the test-only route, and only against local Supabase. The
 * Playwright config refuses to start unless the API URL is http on
 * 127.0.0.1 or localhost. Do not point this file at production.
 */

test("sign in, create a couple circle, invite, join, and ping", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const nonce = crypto.randomUUID();
  const ownerEmail = `e2e-owner-${nonce}@example.com`;
  const partnerEmail = `e2e-partner-${nonce}@example.com`;

  await signIn(page, { email: ownerEmail, displayName: "Isaac" });

  await page.goto("/circles");
  await expect(page.getByRole("heading", { name: "Circles" })).toBeVisible();
  await page.getByLabel("Name").fill("Me & Summer");
  await page.getByRole("button", { name: "Create a circle" }).click();
  await expect(page).toHaveURL(/\/circles\/[0-9a-f-]{36}$/i, {
    timeout: 20_000,
  });
  await expect(
    page.getByRole("heading", { name: "Me & Summer" }),
  ).toBeVisible();
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();

  const invite = page.locator('a[href*="/join/"]');
  await expect(invite).toBeVisible();
  const href = await invite.getAttribute("href");
  expect(href).toMatch(/\/join\/[0-9a-f]{64}$/);

  const partner = await browser.newContext({ baseURL });
  const partnerPage = await partner.newPage();
  try {
    await partnerPage.goto(href!);
    await expect(
      partnerPage.getByRole("heading", { name: "Join a circle" }),
    ).toBeVisible();
    await expect(
      partnerPage.getByText(/sign in to see who invited you/i),
    ).toBeVisible();

    await signIn(partnerPage, {
      email: partnerEmail,
      displayName: "Summer",
    });
    await partnerPage.goto(href!);
    await expect(partnerPage.getByText(/Join Me & Summer/)).toBeVisible();
    await partnerPage.getByRole("button", { name: "Join circle" }).click();
    await expect(partnerPage).toHaveURL(/\/circles\/[0-9a-f-]{36}$/i, {
      timeout: 20_000,
    });
    await expect(
      partnerPage.getByText("Active", { exact: true }),
    ).toBeVisible();
    await expect(
      partnerPage.getByRole("button", { name: "Thinking of You", exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByText(/You're here with Summer/)).toBeVisible();
    await page
      .getByRole("button", { name: "Thinking of You", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(/Saved for Summer/);
    await expect(recent(page)).toContainText("Thinking of you");

    await partnerPage.reload();
    await expect(recent(partnerPage)).toContainText("Isaac");
    await expect(recent(partnerPage)).toContainText("Thinking of you");
  } finally {
    await partner.close();
  }
});

function recent(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Recent" }) });
}

async function signIn(
  page: Page,
  input: { email: string; displayName: string },
) {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();

  const response = await page.request.post("/api/test/sign-in", {
    data: {
      email: input.email,
      displayName: input.displayName,
      timezone: "America/Los_Angeles",
    },
    maxRedirects: 0,
  });
  expect(response.status(), await response.text()).toBe(307);
  const location = response.headers()["location"];
  expect(location).toContain("/auth/callback");
  await page.goto(location!);
  await expect(
    page.getByRole("heading", { name: `Hello, ${input.displayName}` }),
  ).toBeVisible();
  await expect(page.getByText("Timezone: America/Los_Angeles")).toBeVisible();
}

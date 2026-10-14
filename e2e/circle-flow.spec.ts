import { expect, test, type Page } from "@playwright/test";

/**
 * Sign in, create a couple circle, invite, join, and send Thinking of You.
 *
 * Auth is the test-only route, and only against local Supabase. The
 * Playwright config refuses to start unless the API URL is http on
 * 127.0.0.1 or localhost. Do not point this file at production.
 */

test("sign in, create a couple circle, invite, join, ping, set a mood, add a memory, open a letter, and set Still Us", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
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
    // CI starts Supabase without Realtime, so the page also shows a status
    // line that live updates are off. Match the ping result itself.
    await expect(
      page.getByRole("status").filter({ hasText: /Saved for Summer/ }),
    ).toBeVisible();
    await expect(recent(page)).toContainText("Thinking of you");

    await partnerPage.reload();
    await expect(recent(partnerPage)).toContainText("Isaac");
    await expect(recent(partnerPage)).toContainText("Thinking of you");

    await page.getByRole("button", { name: "Good" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /No notification was sent/ }),
    ).toBeVisible();
    await expect(moods(page)).toContainText("Good");
    await expect(recent(page)).not.toContainText("Feeling");

    await partnerPage.reload();
    await expect(moods(partnerPage)).toContainText("Isaac");
    await expect(moods(partnerPage)).toContainText("Good");
    await expect(recent(partnerPage)).not.toContainText("Feeling");

    await page
      .getByRole("checkbox", { name: /Also send this as a ping/ })
      .check();
    await page.getByRole("button", { name: "Calm" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /shared with Summer/ }),
    ).toBeVisible();
    await expect(recent(page)).toContainText("Feeling");
    await expect(recent(page)).toContainText("😌");

    await partnerPage.reload();
    await expect(moods(partnerPage)).toContainText("Calm");
    await expect(recent(partnerPage)).toContainText("Feeling");

    const recentDay = utcDay(0);
    const olderDay = utcDay(40);
    await wall(page).getByLabel("Note").fill("Ferry to Bainbridge");
    await wall(page).getByRole("textbox", { name: "Tags" }).fill("summer");
    await wall(page).getByLabel("Date").fill(recentDay);
    await wall(page).getByRole("button", { name: "Add to the wall" }).click();
    await expect(wall(page).getByText("Ferry to Bainbridge")).toBeVisible();
    await expect(
      wall(page).getByRole("heading", { name: monthLabel(recentDay) }),
    ).toBeVisible();

    await wall(page).getByLabel("Note").fill("A cold walk");
    await wall(page).getByRole("textbox", { name: "Tags" }).fill("winter");
    await wall(page).getByLabel("Date").fill(olderDay);
    await wall(page).getByRole("button", { name: "Add to the wall" }).click();
    await expect(
      wall(page).getByRole("heading", { name: monthLabel(olderDay) }),
    ).toBeVisible();

    await wall(page)
      .getByRole("radio", { name: "Only selected people" })
      .check();
    await wall(page).getByLabel("Note").fill("Secret dock");
    await wall(page).getByRole("textbox", { name: "Tags" }).fill("");
    await wall(page).getByLabel("Date").fill(recentDay);
    await wall(page).getByRole("button", { name: "Add to the wall" }).click();
    await expect(wall(page).getByText("Secret dock")).toBeVisible();
    await expect(
      wall(page).getByText("Only you", { exact: true }),
    ).toBeVisible();

    await wall(page)
      .getByLabel("Photo")
      .setInputFiles({
        name: "pixel.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
    await wall(page).getByLabel("Note").fill("Pixel");
    await wall(page).getByRole("textbox", { name: "Tags" }).fill("summer");
    await wall(page).getByLabel("Date").fill(recentDay);
    await wall(page)
      .getByRole("radio", { name: "Everyone in the circle" })
      .check();
    await wall(page).getByRole("button", { name: "Add to the wall" }).click();
    await expect(wall(page).getByRole("img", { name: "Pixel" })).toBeVisible();

    await wall(page)
      .getByRole("button", { name: "summer", exact: true })
      .click();
    await expect(
      wall(page).getByRole("heading", { name: monthLabel(olderDay) }),
    ).toHaveCount(0);
    await expect(wall(page).getByText("Ferry to Bainbridge")).toBeVisible();

    await partnerPage.reload();
    await expect(
      wall(partnerPage).getByText("Ferry to Bainbridge"),
    ).toBeVisible();
    await expect(
      wall(partnerPage).getByRole("img", { name: "Pixel" }),
    ).toBeVisible();
    await expect(wall(partnerPage).getByText("Secret dock")).toHaveCount(0);

    await wall(page).getByRole("button", { name: "All", exact: true }).click();
    await wall(page)
      .getByRole("button", { name: "Remove Secret dock" })
      .click();
    await expect(wall(page).getByText("Secret dock")).toHaveCount(0);

    const isaacLetters = letters(page);
    await isaacLetters.getByLabel("Open when").selectOption("need-motivation");
    await isaacLetters.getByLabel("Title").fill("For the ferry");
    await isaacLetters.getByLabel("Letter").fill("The ferry is still ours.");
    await isaacLetters.getByText("Kawaii", { exact: true }).click();
    await isaacLetters.getByRole("button", { name: "Send the letter" }).click();
    await expect(
      isaacLetters.getByRole("status").filter({ hasText: "Sent to Summer" }),
    ).toBeVisible();
    await expect(
      isaacLetters.getByRole("heading", { name: "Dear Summer" }),
    ).toBeVisible();
    await expect(
      isaacLetters.getByText("The ferry is still ours."),
    ).toBeVisible();

    await partnerPage.reload();
    const summerLetters = letters(partnerPage);
    await expect(
      summerLetters.getByText("The ferry is still ours."),
    ).toHaveCount(0);
    await summerLetters.getByRole("button", { name: "Open letter" }).click();
    await expect(
      summerLetters.getByText("The ferry is still ours."),
    ).toBeVisible();
    await expect(
      summerLetters.getByRole("heading", { name: "Dear Summer" }),
    ).toBeVisible();
    await expect(wall(partnerPage).getByText("Opened letter")).toBeVisible();

    await page.reload();
    await expect(wall(page).getByText("Opened letter")).toBeVisible();
    await expect(
      wall(page).getByRole("link", { name: "Read the letter" }),
    ).toBeVisible();

    const still = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Still Us" }) });
    await still.getByLabel("Reunion date").fill("2027-02-14");
    await still.getByRole("button", { name: "Save the date" }).click();
    await expect(
      still.getByRole("status").filter({ hasText: "Saved" }),
    ).toBeVisible();
    await expect(still.getByText(/\d+ days|Today/)).toBeVisible();

    await still.getByLabel("Checkpoint", { exact: true }).fill("Flight booked");
    await still.getByLabel("Checkpoint date").fill("2027-03-01");
    await still.getByLabel("When one of you marks it").check();
    await still.getByRole("button", { name: "Add checkpoint" }).click();
    await still.getByRole("button", { name: "Mark hit" }).click();
    await expect(
      still.getByText("Hit. It's on the memory wall."),
    ).toBeVisible();
    await expect(wall(page).getByText("Still Us")).toBeVisible();
    await expect(wall(page).getByText("Flight booked")).toBeVisible();

    await partnerPage.reload();
    const partnerStill = partnerPage.locator("section").filter({
      has: partnerPage.getByRole("heading", { name: "Still Us" }),
    });
    await expect(partnerStill.getByText(/\d+ days|Today/)).toBeVisible();
    await expect(wall(partnerPage).getByText("Flight booked")).toBeVisible();

    await isaacLetters.getByLabel("Later").check();
    await isaacLetters.getByLabel("Date").fill("2027-06-01");
    await isaacLetters.getByLabel("Time").fill("08:00");
    await isaacLetters.getByLabel("Letter").fill("Open this in the morning.");
    await isaacLetters.getByRole("button", { name: "Send the letter" }).click();
    await expect(
      isaacLetters.getByRole("status").filter({ hasText: /It will arrive/ }),
    ).toBeVisible();
    await partnerPage.reload();
    await expect(
      letters(partnerPage).getByText("Open this in the morning."),
    ).toHaveCount(0);
  } finally {
    await partner.close();
  }
});

function moods(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Mood" }) });
}

function letters(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Letters" }) });
}

function wall(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Memory wall" }) });
}

function utcDay(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function monthLabel(iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year!, (month ?? 1) - 1, 1)));
}

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
  // The session cookie is host-only. localhost and 127.0.0.1 are different
  // hosts, so the callback has to stay on the origin the browser already has.
  expect(new URL(location!).origin).toBe(new URL(page.url()).origin);
  await page.goto(location!);
  await expect(
    page.getByRole("heading", { name: `Hello, ${input.displayName}` }),
  ).toBeVisible();
  await expect(page.getByText("Timezone: America/Los_Angeles")).toBeVisible();
}

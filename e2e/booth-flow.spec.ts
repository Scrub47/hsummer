import { expect, test, type Page } from "@playwright/test";

/**
 * Solo Booth against local Supabase only. The smoke config ignores this
 * file. A strip can be downloaded before it is saved, and the wall does
 * not show it until Save.
 */

test("pass a 4-cut: one person shoots, the other finishes the strip", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const nonce = crypto.randomUUID();
  await signIn(page, {
    email: `e2e-pass-${nonce}@example.com`,
    displayName: "Isaac",
  });

  await page.goto("/circles");
  await page.getByLabel("Name").fill("Pass circle");
  await page.getByRole("button", { name: "Create a circle" }).click();
  await expect(page).toHaveURL(/\/circles\/[0-9a-f-]{36}$/i, {
    timeout: 20_000,
  });

  const invite = page.locator('a[href*="/join/"]');
  await expect(invite).toBeVisible();
  const href = await invite.getAttribute("href");
  expect(href).toMatch(/\/join\/[0-9a-f]{64}$/);

  const partner = await browser.newContext({ baseURL });
  const partnerPage = await partner.newPage();
  try {
    await signIn(partnerPage, {
      email: `e2e-pass-partner-${nonce}@example.com`,
      displayName: "Summer",
    });
    await partnerPage.goto(href!);
    await partnerPage.getByRole("button", { name: "Join circle" }).click();
    await expect(partnerPage.getByText("Active", { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    await page.reload();
    await page.getByRole("link", { name: "Open the photo booth" }).click();
    await page.getByRole("button", { name: "Pass it on" }).click();
    const jpeg = await jpegFile(page);
    await page.getByLabel("Photos for your frames").setInputFiles([jpeg, jpeg]);
    await page.getByRole("button", { name: "Pass it to Summer" }).click();
    await expectNotice(page, /Passed on/);

    await partnerPage.reload();
    await expect(
      partnerPage.getByText("It's your turn in the photo booth."),
    ).toBeVisible();
    await partnerPage.getByRole("link", { name: "Take your frames" }).click();
    await expect(
      partnerPage.getByRole("heading", { name: /Your turn/ }),
    ).toBeVisible();
    const partnerJpeg = await jpegFile(partnerPage);
    await partnerPage
      .getByLabel("Photos for your frames")
      .setInputFiles([partnerJpeg, partnerJpeg]);
    await partnerPage.getByRole("button", { name: "Add your frames" }).click();
    await expectNotice(partnerPage, /memory wall/);

    await page.goto(page.url().replace(/\/booth$/, ""));
    await expect(page.getByText("you and Summer")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByText("Kawaii · 4-cut · Passed · No filter"),
    ).toBeVisible();
  } finally {
    await partner.close();
  }
});

test("download a kawaii strip, then save it on the memory wall", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const nonce = crypto.randomUUID();
  await signIn(page, {
    email: `e2e-booth-${nonce}@example.com`,
    displayName: "Isaac",
  });

  const jpeg = await jpegFile(page);

  await page.goto("/circles");
  await page.getByLabel("Name").fill("Booth circle");
  await page.getByRole("button", { name: "Create a circle" }).click();
  await expect(page).toHaveURL(/\/circles\/[0-9a-f-]{36}$/i, {
    timeout: 20_000,
  });

  await page.getByRole("link", { name: "Open the photo booth" }).click();
  await expect(
    page.getByRole("heading", { name: "Photo booth" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Nothing is saved until you choose Save/),
  ).toBeVisible();

  await page
    .getByLabel("Photos from your library")
    .setInputFiles([jpeg, jpeg, jpeg, jpeg]);
  await expect(
    page.getByRole("img", { name: "Kawaii 4-cut photo booth strip" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Download" })).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("hsummer-kawaii-strip.jpg");

  await page.getByRole("link", { name: /Back to Booth circle/ }).click();
  await expect(
    page.getByRole("img", { name: /photo booth strip/i }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "Open the photo booth" }).click();
  await page
    .getByLabel("Photos from your library")
    .setInputFiles([jpeg, jpeg, jpeg, jpeg]);
  await page.getByRole("button", { name: "Save to this circle" }).click();
  await expectNotice(page, /Saved on the memory wall/);
  await page.getByRole("link", { name: "See it on the wall" }).click();
  await expect(
    page.getByRole("img", { name: /photo booth strip from you/i }),
  ).toBeVisible();
  await expect(page.getByText("Kawaii · 4-cut · No filter")).toBeVisible();
});

async function expectNotice(page: Page, pattern: RegExp) {
  const target = page.getByRole("status").filter({ hasText: pattern });
  try {
    await expect(target).toBeVisible({ timeout: 20_000 });
  } catch (error) {
    const alerts = await page.getByRole("alert").allTextContents();
    throw new Error(`missing ${pattern}; alerts=${JSON.stringify(alerts)}`, {
      cause: error,
    });
  }
}

async function jpegFile(page: Page) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    context.fillStyle = "#c4556a";
    context.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.9);
    });
    if (!blob) throw new Error("jpeg");
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return {
    name: "shot.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(bytes),
  };
}

async function signIn(
  page: Page,
  input: { email: string; displayName: string },
) {
  await page.goto("/sign-in");
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
  expect(new URL(location!).origin).toBe(new URL(page.url()).origin);
  await page.goto(location!);
  await expect(
    page.getByRole("heading", { name: `Hello, ${input.displayName}` }),
  ).toBeVisible();
}

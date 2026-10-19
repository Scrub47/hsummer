/*
 * Push service worker. It has to live in /public so the URL is /sw.js and
 * the scope is the whole origin. Next.js will not compile this file.
 *
 * The payload is whatever the server encrypted. The server is responsible
 * for keeping private Circle content out of it. If the JSON is missing or
 * broken, show a generic notification anyway.
 */

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192-v2.png",
      badge: "/icons/icon-192-v2.png",
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeSameOriginUrl(
    event.notification.data && event.notification.data.url,
  );

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        for (const client of clients) {
          if (
            client.url.startsWith(self.location.origin) &&
            "focus" in client
          ) {
            if (typeof client.navigate === "function") {
              try {
                await client.navigate(target);
              } catch {
                // Focusing still opens the app. The list is behind sign-in.
              }
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(target);
        }
        return undefined;
      }),
  );
});

function readPayload(event) {
  const fallback = {
    title: "Hsummer",
    body: "You have a new notification.",
    url: "/home",
  };
  if (!event.data) return fallback;
  try {
    const parsed = event.data.json();
    return {
      title:
        typeof parsed.title === "string" && parsed.title
          ? parsed.title
          : fallback.title,
      body:
        typeof parsed.body === "string" && parsed.body
          ? parsed.body
          : fallback.body,
      url: typeof parsed.url === "string" ? parsed.url : fallback.url,
    };
  } catch {
    return fallback;
  }
}

function safeSameOriginUrl(value) {
  if (typeof value !== "string" || value.length === 0) return "/home";
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return "/home";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/home";
  }
}

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  assertBackupProjectUrl,
  assertPassphrase,
  backupObjectName,
  backupObjectsToDelete,
  backupUploadFailure,
} from "./backup-lib.mjs";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Pass the encrypted dump path.");
  process.exit(1);
}

const project = assertBackupProjectUrl(process.env.SUPABASE_URL ?? "");
if (!project.ok) {
  console.error(project.error);
  process.exit(1);
}

const passphrase = assertPassphrase(process.env.BACKUP_PASSPHRASE ?? "");
if (!passphrase.ok) {
  console.error(passphrase.error);
  process.exit(1);
}

const secret = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
if (secret.length < 20 || secret.includes("your-secret")) {
  console.error(
    "SUPABASE_SECRET_KEY is missing. In Project Settings → API keys, copy the secret key (sb_secret_...) and add it under GitHub Settings → Secrets and variables → Actions. Do not use the publishable key.",
  );
  process.exit(1);
}

const supabase = createClient(project.url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const nonce = randomBytes(4).toString("hex");
const objectName = backupObjectName(new Date(), nonce);
const objectPath = `weekly/${objectName}`;
const bytes = await readFile(filePath);

const uploaded = await supabase.storage
  .from("backups")
  .upload(objectPath, bytes, {
    contentType: "application/octet-stream",
    upsert: false,
  });
if (uploaded.error) {
  console.error(backupUploadFailure(uploaded.error.message));
  console.error(uploaded.error.message);
  process.exit(1);
}

const names = await listWeekly();
const stale = backupObjectsToDelete(names);
if (stale.length > 0) {
  const removed = await supabase.storage
    .from("backups")
    .remove(stale.map((name) => `weekly/${name}`));
  if (removed.error) {
    console.error(
      "The new dump is uploaded. Deleting dumps older than the latest 8 failed.",
    );
    console.error(removed.error.message);
    process.exit(1);
  }
}

console.log(
  `Uploaded ${objectPath}. Keeping the latest 8 weekly dumps; removed ${stale.length} older file(s).`,
);

async function listWeekly() {
  const names = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const listed = await supabase.storage.from("backups").list("weekly", {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (listed.error) {
      console.error(backupUploadFailure(listed.error.message));
      console.error(listed.error.message);
      process.exit(1);
    }
    const batch = listed.data ?? [];
    for (const object of batch) {
      if (object.name) names.push(object.name);
    }
    if (batch.length < 100) break;
  }
  return names;
}

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const testDirectory = mkdtempSync(join(tmpdir(), "architecture-entra-auth-"));
process.env.DATABASE_PATH = join(testDirectory, "entra-auth.sqlite");

const { run, one, now } = await import("../db.js");
const { resolveWorkbenchActor } = await import("./entra-auth.js");

const tenantId = "11111111-1111-4111-8111-111111111111";
const userObjectId = "22222222-2222-4222-8222-222222222222";

function person(id: string, email: string, isAdmin = 0) {
  run(
    "INSERT INTO people(id,display_name,title,email,avatar_color,is_admin,created_at) VALUES(?,?,?,?,?,?,?)",
    id, id, "Architect", email, "#777777", isAdmin, now(),
  );
}

test("delegated users resolve only by their tenant and immutable Entra object ID", () => {
  person("person-a", "a@example.test");
  person("person-b", "b@example.test");
  run("UPDATE people SET entra_tenant_id=?,entra_object_id=? WHERE id=?", tenantId, userObjectId, "person-a");

  assert.equal(
    resolveWorkbenchActor(
      { tenantId, objectId: userObjectId, applicationOnly: false },
      { serviceUserId: "agent", autoLinkByEmail: false },
    ),
    "person-a",
  );
  assert.equal(
    resolveWorkbenchActor(
      { tenantId: "33333333-3333-4333-8333-333333333333", objectId: userObjectId, applicationOnly: false },
      { serviceUserId: "agent", autoLinkByEmail: false },
    ),
    null,
  );
});

test("email linking is disabled by default and requires one unambiguous Person", () => {
  person("email-person", "person@example.test");
  const principal = {
    tenantId,
    objectId: "44444444-4444-4444-8444-444444444444",
    applicationOnly: false,
    email: "PERSON@example.test",
  };

  assert.equal(resolveWorkbenchActor(principal, { serviceUserId: "agent", autoLinkByEmail: false }), null);
  assert.equal(
    one<{ entra_object_id: string | null }>("SELECT entra_object_id FROM people WHERE id=?", "email-person")?.entra_object_id,
    null,
  );
  assert.equal(resolveWorkbenchActor(principal, { serviceUserId: "agent", autoLinkByEmail: true }), "email-person");
  assert.equal(
    one<{ entra_tenant_id: string; entra_object_id: string }>(
      "SELECT entra_tenant_id,entra_object_id FROM people WHERE id=?", "email-person",
    )?.entra_tenant_id,
    tenantId,
  );
});

test("ambiguous email matches are never auto-linked", () => {
  person("duplicate-a", "shared@example.test");
  person("duplicate-b", "SHARED@example.test");
  assert.equal(
    resolveWorkbenchActor(
      {
        tenantId,
        objectId: "55555555-5555-4555-8555-555555555555",
        applicationOnly: false,
        email: "shared@example.test",
      },
      { serviceUserId: "agent", autoLinkByEmail: true },
    ),
    null,
  );
});

test("app-only callers map only to a configured non-admin service Person", () => {
  person("agent", "agent@example.test");
  person("admin-agent", "admin-agent@example.test", 1);
  assert.equal(
    resolveWorkbenchActor(
      { tenantId, objectId: "66666666-6666-4666-8666-666666666666", applicationOnly: true },
      { serviceUserId: "agent", autoLinkByEmail: false },
    ),
    "agent",
  );
  assert.equal(
    resolveWorkbenchActor(
      { tenantId, objectId: "77777777-7777-4777-8777-777777777777", applicationOnly: true },
      { serviceUserId: "admin-agent", autoLinkByEmail: false },
    ),
    null,
  );
});

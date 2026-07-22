import { describe, expect, test } from "bun:test";
import {
  canonicalIdentitySignal,
  materialCloneSignal,
  sourceReferenceSignal,
} from "../../src/features/public/identity-signals";

const sha256Pattern = /^[a-f0-9]{64}$/u;

describe("public identity signals", () => {
  test("keeps canonical identity stable across source ordering and typography", async () => {
    const first = await canonicalIdentitySignal({
      locationIds: ["loc:beijing", "loc:haidian"],
      organizationId: "org:school",
      roleFamily: "subject_specialist",
      subjects: ["Physics", "Math"],
      title: "Physics & Math Teacher",
    });
    const second = await canonicalIdentitySignal({
      locationIds: ["loc:haidian", "loc:beijing", "loc:beijing"],
      organizationId: "org:school",
      roleFamily: "subject_specialist",
      subjects: ["math", "physics", "MATH"],
      title: "  PHYSICS / MATH teacher ",
    });

    expect(first.kind).toBe("canonical_identity_v1");
    expect(first.hash).toMatch(sha256Pattern);
    expect(first.hash).toBe(second.hash);
  });

  test("separates different organizations and role families", async () => {
    const baseline = await canonicalIdentitySignal({
      locationIds: ["loc:beijing"],
      organizationId: "org:a",
      roleFamily: "english_language",
      subjects: ["English"],
      title: "English Teacher",
    });
    const organizationChange = await canonicalIdentitySignal({
      locationIds: ["loc:beijing"],
      organizationId: "org:b",
      roleFamily: "english_language",
      subjects: ["English"],
      title: "English Teacher",
    });
    const roleChange = await canonicalIdentitySignal({
      locationIds: ["loc:beijing"],
      organizationId: "org:a",
      roleFamily: "homeroom",
      subjects: ["English"],
      title: "English Teacher",
    });

    expect(baseline.hash).not.toBe(organizationChange.hash);
    expect(baseline.hash).not.toBe(roleChange.hash);
  });

  test("preserves punctuation and case in durable entity identifiers", async () => {
    const first = await canonicalIdentitySignal({
      locationIds: ["loc:a-b"],
      organizationId: "org:a",
      roleFamily: "english_language",
      subjects: ["English"],
      title: "English Teacher",
    });
    const second = await canonicalIdentitySignal({
      locationIds: ["loc:a:b"],
      organizationId: "ORG:A",
      roleFamily: "english_language",
      subjects: ["English"],
      title: "English Teacher",
    });

    expect(first.hash).not.toBe(second.hash);
  });

  test("namespaces material and stable source-reference signals", async () => {
    const material = await materialCloneSignal("a".repeat(64));
    const source = await sourceReferenceSignal({
      sourceKey: "Serious Teachers",
      sourceReference: " vacancy-123 ",
    });

    expect(material.kind).toBe("material_clone_v1");
    expect(source.kind).toBe("source_reference_v1");
    expect(material.hash).not.toBe(source.hash);
  });
});

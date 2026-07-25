import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { countrySweeps } from "./country-sweeps";
import { jobListings } from "./jobs";

export const organizations = sqliteTable(
  "organizations",
  {
    canonicalDomain: text("canonical_domain").default("").notNull(),
    city: text().default("").notNull(),
    countryCode: text("country_code").notNull(),
    countryName: text("country_name").notNull(),
    createdAt: text("created_at").notNull(),
    evidenceUrl: text("evidence_url").default("").notNull(),
    id: text().primaryKey(),
    identityKey: text("identity_key").notNull(),
    lastVerifiedAt: text("last_verified_at"),
    marketSegment: text("market_segment").default("school").notNull(),
    name: text().notNull(),
    outreachEligibility: text("outreach_eligibility")
      .default("review")
      .notNull(),
    region: text().default("").notNull(),
    sourceSweepId: text("source_sweep_id").references(() => countrySweeps.id, {
      onDelete: "set null",
    }),
    status: text().default("unverified").notNull(),
    updatedAt: text("updated_at").notNull(),
    websiteUrl: text("website_url").default("").notNull(),
  },
  (table) => [
    uniqueIndex("idx_organizations_country_domain")
      .on(table.countryCode, table.canonicalDomain)
      .where(sql`canonical_domain<>''`),
    uniqueIndex("idx_organizations_country_identity").on(
      table.countryCode,
      table.identityKey
    ),
    index("idx_organizations_country_status").on(
      table.countryCode,
      table.status,
      table.outreachEligibility,
      table.name
    ),
  ]
);

export const organizationContactPoints = sqliteTable(
  "organization_contact_points",
  {
    createdAt: text("created_at").notNull(),
    evidenceUrl: text("evidence_url").default("").notNull(),
    id: text().primaryKey(),
    kind: text().notNull(),
    label: text().default("").notNull(),
    lastVerifiedAt: text("last_verified_at"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: text().default("unverified").notNull(),
    updatedAt: text("updated_at").notNull(),
    value: text().notNull(),
  },
  (table) => [
    index("idx_organization_contacts_org_status").on(
      table.organizationId,
      table.status,
      table.kind
    ),
    unique().on(table.organizationId, table.kind, table.value),
  ]
);

export const organizationOpportunities = sqliteTable(
  "organization_opportunities",
  {
    evidenceUrl: text("evidence_url").default("").notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobListings.id, { onDelete: "cascade" }),
    linkedAt: text("linked_at").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.jobId],
      name: "organization_opportunities_organization_id_job_id_pk",
    }),
  ]
);

export const contacts = sqliteTable("contacts", {
  createdAt: text("created_at").notNull(),
  displayName: text("display_name").default("").notNull(),
  id: text().primaryKey(),
  organizationName: text("organization_name").default("").notNull(),
  role: text().default("unknown").notNull(),
  status: text().default("active").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const contactChannels = sqliteTable(
  "contact_channels",
  {
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    kind: text().notNull(),
    normalizedValue: text("normalized_value").notNull(),
    status: text().default("active").notNull(),
    updatedAt: text("updated_at").notNull(),
    value: text().notNull(),
  },
  (table) => [
    index("idx_contact_channels_contact_status").on(
      table.contactId,
      table.status,
      table.kind
    ),
    unique().on(table.kind, table.normalizedValue),
  ]
);

export const organizationEvidence = sqliteTable(
  "organization_evidence",
  {
    createdAt: text("created_at").notNull(),
    evidenceKind: text("evidence_kind").notNull(),
    evidenceStatus: text("evidence_status").notNull(),
    id: text().primaryKey(),
    metadataJson: text("metadata_json").default("{}").notNull(),
    notes: text().default("").notNull(),
    observedAt: text("observed_at").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    postingContext: text("posting_context").default("").notNull(),
    provenancePath: text("provenance_path").default("").notNull(),
    roles: text().default("").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceLabel: text("source_label").default("").notNull(),
    sourceSweepId: text("source_sweep_id").references(() => countrySweeps.id, {
      onDelete: "set null",
    }),
    sourceUrl: text("source_url").default("").notNull(),
  },
  (table) => [
    index("idx_organization_evidence_sweep").on(
      table.sourceSweepId,
      table.evidenceKind,
      table.evidenceStatus
    ),
    index("idx_organization_evidence_org_observed").on(
      table.organizationId,
      sql`${table.observedAt} desc`
    ),
    unique().on(
      table.organizationId,
      table.sourceKind,
      table.sourceUrl,
      table.roles
    ),
  ]
);

export const canonicalLocations = sqliteTable(
  "canonical_locations",
  {
    boundsJson: text("bounds_json"),
    countryCode: text("country_code"),
    createdAt: text("created_at").notNull(),
    displayName: text("display_name").notNull(),
    id: text().primaryKey(),
    inputLabel: text("input_label").notNull(),
    latitude: real(),
    locality: text().default("").notNull(),
    longitude: real(),
    provider: text().default("").notNull(),
    providerPlaceId: text("provider_place_id").default("").notNull(),
    region: text().default("").notNull(),
    resolutionEvidenceJson: text("resolution_evidence_json")
      .default("{}")
      .notNull(),
    resolutionState: text("resolution_state").notNull(),
    supersededByLocationId: text("superseded_by_location_id"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_canonical_locations_provider_identity")
      .on(table.provider, table.providerPlaceId)
      .where(sql`provider<>'' AND provider_place_id<>''`),
    foreignKey(() => ({
      columns: [table.supersededByLocationId],
      foreignColumns: [table.id],
      name: "canonical_locations_superseded_by_location_id_canonical_locations_id_fk",
    })).onDelete("restrict"),
  ]
);

export const organizationSourceEmployerMappings = sqliteTable(
  "organization_source_employer_mappings",
  {
    acceptedAt: text("accepted_at").notNull(),
    acceptedByUserId: text("accepted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    employerId: text("employer_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    sourceKey: text("source_key").notNull(),
  },
  (table) => [
    index("idx_org_source_employer_mapping_org").on(
      table.organizationId,
      table.sourceKey
    ),
    primaryKey({
      columns: [table.sourceKey, table.employerId],
      name: "organization_source_employer_mappings_source_key_employer_id_pk",
    }),
  ]
);

export const organizationDomainMappings = sqliteTable(
  "organization_domain_mappings",
  {
    acceptedAt: text("accepted_at").notNull(),
    acceptedByUserId: text("accepted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    evidenceUrl: text("evidence_url").notNull(),
    id: text().primaryKey(),
    mappingKind: text("mapping_kind").notNull(),
    normalizedHost: text("normalized_host").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    pathPrefix: text("path_prefix").default("").notNull(),
    publicSuffixListVersion: text("public_suffix_list_version").notNull(),
    registrableDomain: text("registrable_domain").notNull(),
  },
  (table) => [
    index("idx_org_domain_mapping_org").on(
      table.organizationId,
      table.mappingKind
    ),
    index("idx_org_domain_mapping_lookup").on(
      table.publicSuffixListVersion,
      table.normalizedHost,
      table.registrableDomain,
      table.mappingKind
    ),
    unique().on(
      table.mappingKind,
      table.normalizedHost,
      table.pathPrefix,
      table.organizationId
    ),
  ]
);

export const organizationOpportunityAcceptances = sqliteTable(
  "organization_opportunity_acceptances",
  {
    acceptedAt: text("accepted_at").notNull(),
    acceptedByUserId: text("accepted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    jobId: text("job_id").notNull(),
    organizationId: text("organization_id").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.organizationId, table.jobId],
      foreignColumns: [
        organizationOpportunities.organizationId,
        organizationOpportunities.jobId,
      ],
      name: "organization_opportunity_acceptances_organization_id_job_id_organization_opportunities_organization_id_job_id_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.organizationId, table.jobId],
      name: "organization_opportunity_acceptances_organization_id_job_id_pk",
    }),
  ]
);

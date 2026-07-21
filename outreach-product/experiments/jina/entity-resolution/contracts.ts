import type { RealJobDocument } from "../real/contracts";

export type EntityLinkCaseKind = "match" | "no_match";

export interface EntityFacts {
  contactName: string;
  country: string;
  domain: string;
  location: string;
  name: string;
}

export interface EntityDocument extends RealJobDocument {
  facts: EntityFacts;
}

export interface EntityLinkCase {
  anchor: EntityDocument;
  candidates: EntityDocument[];
  expectedId: string | null;
  id: string;
  kind: EntityLinkCaseKind;
  rootId: string;
}

export interface EntityLinkCorpus {
  cases: EntityLinkCase[];
  corpusVersion: string;
  createdAt: string;
  source: {
    activeJobs: number;
    corpusKind: "controlled_alias_calibration";
    databasePath: string;
    entityRoots: number;
  };
}

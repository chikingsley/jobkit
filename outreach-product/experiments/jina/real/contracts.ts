export interface RealJobDocument {
  id: string;
  text: string;
}

export type RealCapability =
  | "deduplication"
  | "reader"
  | "reranking"
  | "search";

export interface ReaderCase {
  board: string;
  description: string;
  id: string;
  markers: Array<{ field: string; value: string }>;
  url: string;
}

export interface SearchCase {
  expectedDomain: string;
  id: string;
  query: string;
  sourceJobId: string;
}

export interface RankingCase {
  documents: RealJobDocument[];
  expectedId: string;
  id: string;
  query: string;
}

export interface DeduplicationCase {
  anchor: RealJobDocument;
  candidates: RealJobDocument[];
  expectedId: string;
  id: string;
}

export interface RealCapabilityCorpus {
  corpusVersion: string;
  createdAt: string;
  deduplication: DeduplicationCase[];
  reader: ReaderCase[];
  reranking: RankingCase[];
  search: SearchCase[];
  source: {
    activeJobs: number;
    databasePath: string;
  };
}

export interface TimedResult<T> {
  error?: string;
  id: string;
  latencyMs: number;
  output?: T;
}

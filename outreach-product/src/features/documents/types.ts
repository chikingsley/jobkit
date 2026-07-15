export const documentPacketDefinitions = [
  {
    categories: ["resume", "degree", "tefl"],
    description: "Resume, degree or diploma, and TEFL certificate.",
    name: "English teaching core",
    slug: "english-teaching-core",
  },
  {
    categories: ["resume", "degree", "tefl", "passport", "photo"],
    description:
      "Core teaching documents plus passport and professional photo.",
    name: "Visa market",
    slug: "visa-market",
  },
] as const;

export type DocumentPacketSlug =
  (typeof documentPacketDefinitions)[number]["slug"];

export interface DocumentPacketItem {
  category: string;
  documentId: string;
  filename: string;
  position: number;
}

export interface DocumentPacket {
  description: string;
  id: string;
  isDefault: boolean;
  items: DocumentPacketItem[];
  missingCategories: string[];
  name: string;
  slug: DocumentPacketSlug;
}

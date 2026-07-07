export interface Settings {
  rootDir?: string | null;
  textbookDir?: string | null;
  panelPinned?: boolean | null;
  wovenStyle?: boolean | null;
}

export interface CatalogVideo {
  id: string;
  title: string;
  filename: string;
  ext: string;
  folder: string;
  builtinPlayable: boolean;
  durationSec: number;
  position: number;
  duration: number;
  completed: boolean;
}

export interface CatalogSection {
  id: string;
  title: string;
  videos: CatalogVideo[];
}

export interface CatalogSnapshot {
  rootConfigured: boolean;
  rootPath?: string | null;
  videoCount: number;
  completedCount: number;
  sections: CatalogSection[];
}

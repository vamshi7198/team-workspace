import type { Property, Row, View, ViewConfig } from "@/lib/db-engine/types";
import type { DatabaseMeta, Member } from "@/lib/queries";
import type { useDbActions } from "./use-db-actions";

export type ViewProps = {
  db: DatabaseMeta;
  view: View;
  config: ViewConfig;
  rows: Row[];
  members: Map<string, Member>;
  membersList: Member[];
  canEdit: boolean;
  actions: ReturnType<typeof useDbActions>;
  onConfig: (c: ViewConfig) => void;
  /** null = add a new property */
  onEditProperty: (p: Property | null) => void;
};

// Shared types for database properties, values and view configuration.
// Imported by both the server (query engine) and the client (views, editors).

export type PropertyType =
  | "title"
  | "text"
  | "number"
  | "status"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "person"
  | "created_time"
  | "edited_time"
  | "created_by"
  | "relation"
  | "formula"
  | "rollup";

export type OptionColor = "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";
export type SelectOption = { id: string; name: string; color: OptionColor; group?: "todo" | "in_progress" | "done" };

export type RollupFunction =
  | "count"
  | "count_values"
  | "sum"
  | "average"
  | "min"
  | "max"
  | "percent_checked"
  | "percent_where"
  | "show_original";

export type PropertyConfig = {
  options?: SelectOption[];
  numberFormat?: "number" | "percent" | "currency_inr" | "currency_usd";
  /** relation: the database rows link to. */
  targetDatabaseId?: string;
  /** relation: set on the reverse side; links are stored under this (forward) property. */
  reverseOf?: string;
  /** relation: id of the reverse property on the target database, if two-way. */
  reversePropertyId?: string;
  /** formula */
  expression?: string;
  /** rollup */
  relationPropertyId?: string;
  targetPropertyId?: string;
  rollup?: RollupFunction;
  /** rollup percent_where: option id or value to compare with */
  whereValue?: string;
  /** date */
  includeTime?: boolean;
};

export type Property = {
  id: string;
  name: string;
  type: PropertyType;
  config: PropertyConfig;
  systemKey?: string | null;
  position: number;
};

export type DateValue = { start: string; end?: string | null };

/** Raw value as stored (props JSONB) or computed. */
export type Value = string | number | boolean | null | string[] | DateValue | Date;

export type RelationRef = { id: string; title: string; icon?: string | null };

/** A row with all values resolved, as sent to clients. */
export type Row = {
  id: string;
  title: string;
  icon: string | null;
  sortKey: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  values: Record<string, Value>;
  relations: Record<string, RelationRef[]>;
};

export type FilterOp =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "is_empty"
  | "is_not_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_any_of"
  | "is_none_of"
  | "before"
  | "after"
  | "on_or_before"
  | "on_or_after"
  | "within_next_days"
  | "within_past_days"
  | "is_checked"
  | "is_not_checked"
  | "is_done"
  | "is_not_done";

export type FilterCondition = {
  propertyId: string; // property id, or "title"
  op: FilterOp;
  value?: string | number | boolean | string[] | null;
};

export type Filter = { mode: "and" | "or"; conditions: FilterCondition[] };
export type Sort = { propertyId: string; direction: "asc" | "desc" };

export type ViewConfig = {
  filter?: Filter;
  sorts?: Sort[];
  groupBy?: string | null;
  /** property ids in display order; properties not listed are appended */
  propertyOrder?: string[];
  hidden?: string[];
  widths?: Record<string, number>;
  /** calendar: date property */
  dateProperty?: string | null;
  /** board: hide empty groups */
  hideEmptyGroups?: boolean;
};

export type View = {
  id: string;
  name: string;
  type: "table" | "board" | "calendar" | "list";
  config: ViewConfig;
  position: number;
};

export const OPTION_COLORS: OptionColor[] = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

export type DataType =
  | "STRING"
  | "BYTES"
  | "INTEGER"
  | "INT64"
  | "FLOAT"
  | "FLOAT64"
  | "NUMERIC"
  | "BIGNUMERIC"
  | "BOOLEAN"
  | "BOOL"
  | "TIMESTAMP"
  | "DATE"
  | "TIME"
  | "DATETIME"
  | "INTERVAL"
  | "GEOGRAPHY"
  | "JSON"
  | ArrayType
  | StructType;

interface ArrayType {
  type: "ARRAY";
  items: DataType;
}

interface StructType {
  type: "STRUCT";
  fields: Record<string, DataType>;
}

export const DataTypes = {
  STRING: "STRING" as const,
  BYTES: "BYTES" as const,
  INTEGER: "INTEGER" as const,
  INT64: "INT64" as const,
  FLOAT: "FLOAT" as const,
  FLOAT64: "FLOAT64" as const,
  NUMERIC: "NUMERIC" as const,
  BIGNUMERIC: "BIGNUMERIC" as const,
  BOOLEAN: "BOOLEAN" as const,
  BOOL: "BOOL" as const,
  TIMESTAMP: "TIMESTAMP" as const,
  DATE: "DATE" as const,
  TIME: "TIME" as const,
  DATETIME: "DATETIME" as const,
  INTERVAL: "INTERVAL" as const,
  GEOGRAPHY: "GEOGRAPHY" as const,
  JSON: "JSON" as const,
  ARRAY: (items: DataType): ArrayType => ({ type: "ARRAY", items }),
  STRUCT: (fields: Record<string, DataType>): StructType => ({
    type: "STRUCT",
    fields,
  }),
};

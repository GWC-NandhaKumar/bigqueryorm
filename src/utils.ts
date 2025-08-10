// File: src/utils.ts
import { DataType } from "./dataTypes";
import { Op, Operator } from "./op";

/**
 * Converts DataType to BigQuery schema field format.
 */
export function dataTypeToSchemaField(name: string, dataType: DataType): any {
  if (typeof dataType === "string") {
    return { name, type: dataType };
  }
  if (dataType.type === "ARRAY") {
    return {
      name,
      type: "ARRAY",
      mode: "REPEATED",
      fields: [dataTypeToSchemaField("element", dataType.items)],
    };
  }
  if (dataType.type === "STRUCT") {
    return {
      name,
      type: "STRUCT",
      fields: Object.entries(dataType.fields).map(([fieldName, fieldType]) =>
        dataTypeToSchemaField(fieldName, fieldType)
      ),
    };
  }
  throw new Error(`Unsupported data type: ${JSON.stringify(dataType)}`);
}

/**
 * Builds parameterized WHERE clause recursively for nested conditions.
 */
export function buildWhereClause(
  where: any,
  params: Record<string, any> = {},
  paramIndex = 0
): { clause: string; params: Record<string, any>; nextIndex: number } {
  if (!where) return { clause: "", params: {}, nextIndex: paramIndex };

  const clauses: string[] = [];
  const localParams: Record<string, any> = {};

  for (const [key, value] of Object.entries(where)) {
    if (key === "and" || key === "or") {
      const subResults = (value as any[]).reduce(
        (acc, subCondition) => {
          const built = buildWhereClause(
            subCondition,
            acc.paramsAcc,
            acc.indexAcc
          );
          return {
            clauseAcc: [...acc.clauseAcc, `(${built.clause})`],
            paramsAcc: { ...acc.paramsAcc, ...built.params },
            indexAcc: built.nextIndex,
          };
        },
        {
          clauseAcc: [] as string[],
          paramsAcc: {} as Record<string, any>,
          indexAcc: paramIndex,
        }
      );
      clauses.push(subResults.clauseAcc.join(` ${Op[key as Operator]} `));
      Object.assign(localParams, subResults.paramsAcc);
      paramIndex = subResults.indexAcc;
    } else if (Array.isArray(value)) {
      // Handle array for IN
      const paramNames = value
        .map((v) => {
          const paramName = `param${paramIndex++}`;
          localParams[paramName] = v;
          return `@${paramName}`;
        })
        .join(", ");
      clauses.push(`\`${key}\` IN (${paramNames})`);
    } else if (typeof value === "object" && value !== null) {
      const opKey = Object.keys(value)[0] as Operator;
      const opVal = (value as any)[opKey];
      const sqlOp = Op[opKey] || "=";
      const paramName = `param${paramIndex++}`;
      clauses.push(`\`${key}\` ${sqlOp} @${paramName}`);
      localParams[paramName] = opVal;
    } else {
      const paramName = `param${paramIndex++}`;
      clauses.push(`\`${key}\` = @${paramName}`);
      localParams[paramName] = value;
    }
  }

  return {
    clause: clauses.join(" AND "),
    params: localParams,
    nextIndex: paramIndex,
  };
}

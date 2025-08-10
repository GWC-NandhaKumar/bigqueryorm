// File: src/op.ts
// Extended Op with more operators for flexibility.

export const Op = {
  eq: "=",
  ne: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
  notLike: "NOT LIKE",
  in: "IN",
  notIn: "NOT IN",
  between: "BETWEEN",
  notBetween: "NOT BETWEEN",
  is: "IS",
  isNot: "IS NOT",
  and: "AND",
  or: "OR",
  not: "NOT",
  any: "ANY",
  all: "ALL",
  contains: "@>", // For JSON/ARRAY
  contained: "<@",
} as const;

export type Operator = keyof typeof Op;

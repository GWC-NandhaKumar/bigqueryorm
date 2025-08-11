// op.ts
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
  contains: "@>",
  contained: "<@",
  add: "+",
} as const;

export type Operator = keyof typeof Op;

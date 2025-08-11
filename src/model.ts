import { BigQuery, Job } from "@google-cloud/bigquery";
import { BigQueryORM } from "./bigQueryORM";
import { Op, Operator } from "./op";
import { DataTypes, DataType } from "./dataTypes";
import { buildWhereClause } from "./utils";

export interface WhereOptions {
  [key: string]: any | { [key in Operator]?: any } | WhereOptions[];
}

export interface IncludeOptions {
  model: typeof Model;
  as?: string;
  where?: WhereOptions;
  required?: boolean;
  attributes?: string[];
}

export interface FindOptions {
  attributes?: string[];
  where?: WhereOptions;
  include?: IncludeOptions[];
  order?: [string, "ASC" | "DESC"][];
  group?: string[];
  limit?: number;
  offset?: number;
  raw?: boolean;
}

export interface Association {
  type: "hasOne" | "hasMany" | "belongsTo" | "belongsToMany";
  target: typeof Model;
  foreignKey: string;
  otherKey?: string;
  as?: string;
  through?: typeof Model;
}

export abstract class Model {
  static orm: BigQueryORM;
  static tableName: string;
  static primaryKey: string = "id";
  static attributes: Record<string, DataType>;
  static associations: Record<string, Association> = {};

  static init(
    attributes: Record<string, DataType>,
    options: { orm: BigQueryORM; tableName?: string; primaryKey?: string }
  ) {
    this.orm = options.orm;
    this.attributes = attributes;
    this.tableName = options.tableName || this.name.toLowerCase();
    this.primaryKey = options.primaryKey || "id";
  }

  static belongsTo(
    target: typeof Model,
    options: { foreignKey?: string; as?: string } = {}
  ) {
    const foreignKey = options.foreignKey || `${target.name.toLowerCase()}Id`;
    const as = options.as || target.name.toLowerCase();
    this.associations[as] = { type: "belongsTo", target, foreignKey, as };
    if (!this.attributes[foreignKey]) {
      this.attributes[foreignKey] = DataTypes.INTEGER;
    }
  }

  static hasOne(
    target: typeof Model,
    options: { foreignKey?: string; as?: string } = {}
  ) {
    const foreignKey = options.foreignKey || `${this.name.toLowerCase()}Id`;
    const as = options.as || target.name.toLowerCase();
    this.associations[as] = { type: "hasOne", target, foreignKey, as };
  }

  static hasMany(
    target: typeof Model,
    options: { foreignKey?: string; as?: string } = {}
  ) {
    const foreignKey = options.foreignKey || `${this.name.toLowerCase()}Id`;
    const as = options.as || `${target.name.toLowerCase()}s`;
    this.associations[as] = { type: "hasMany", target, foreignKey, as };
  }

  static belongsToMany(
    target: typeof Model,
    options: {
      through: typeof Model;
      foreignKey?: string;
      otherKey?: string;
      as?: string;
    }
  ) {
    const foreignKey = options.foreignKey || `${this.name.toLowerCase()}Id`;
    const otherKey = options.otherKey || `${target.name.toLowerCase()}Id`;
    const as = options.as || `${target.name.toLowerCase()}s`;
    this.associations[as] = {
      type: "belongsToMany",
      target,
      foreignKey,
      otherKey,
      through: options.through,
      as,
    };
  }

  static async findAll(options: FindOptions = {}): Promise<any[]> {
    const { sql, params } = this.buildSelectQuery(options);
    try {
      const [rows] = await this.orm.bigquery.query({ query: sql, params });
      if (options.raw) {
        return rows;
      }
      return this.nestAssociations(rows, options.include || []);
    } catch (err: any) {
      console.error("FindAll query failed:", err.message);
      throw err;
    }
  }

  static async findOne(options: FindOptions = {}): Promise<any | null> {
    try {
      const results = await this.findAll({ ...options, limit: 1 });
      return results[0] || null;
    } catch (err: any) {
      console.error("FindOne query failed:", err.message);
      throw err;
    }
  }

  static async findByPk(
    pk: any,
    options: FindOptions = {}
  ): Promise<any | null> {
    return this.findOne({ ...options, where: { [this.primaryKey]: pk } });
  }

  static async count(options: FindOptions = {}): Promise<number> {
    const select = `COUNT(DISTINCT \`${this.tableName}\`.\`${this.primaryKey}\`) AS count`;
    const { sql, params } = this.buildSelectQuery(options, select);
    try {
      const [rows] = await this.orm.bigquery.query({ query: sql, params });
      return rows[0]?.count || 0;
    } catch (err: any) {
      console.error("Count query failed:", err.message);
      throw err;
    }
  }

  static async create(data: Record<string, any>): Promise<any> {
    if (this.orm.config.freeTierMode) {
      throw new Error(
        "Free tier mode: CREATE (INSERT) not allowed. Enable billing at https://console.cloud.google.com/billing."
      );
    }
    const table = this.orm.bigquery
      .dataset(this.orm.config.dataset)
      .table(this.tableName);
    try {
      await table.insert([data]);
      if (this.orm.config.logging)
        console.log(`Created record in ${this.tableName}`);
      return data;
    } catch (err: any) {
      console.error(
        `Failed to create record in ${this.tableName}:`,
        err.message
      );
      throw err;
    }
  }

  static async bulkCreate(data: Record<string, any>[]): Promise<void> {
    if (this.orm.config.freeTierMode) {
      throw new Error(
        "Free tier mode: BULK CREATE (INSERT) not allowed. Enable billing at https://console.cloud.google.com/billing."
      );
    }
    if (data.length === 0) return;
    const table = this.orm.bigquery
      .dataset(this.orm.config.dataset)
      .table(this.tableName);
    try {
      await table.insert(data);
      if (this.orm.config.logging)
        console.log(`Bulk created ${data.length} records in ${this.tableName}`);
    } catch (err: any) {
      console.error(
        `Failed to bulk create records in ${this.tableName}:`,
        err.message
      );
      throw err;
    }
  }

  static async update(
    data: Record<string, any>,
    options: { where: WhereOptions }
  ): Promise<number> {
    if (this.orm.config.freeTierMode) {
      throw new Error(
        "Free tier mode: UPDATE not allowed. Enable billing at https://console.cloud.google.com/billing."
      );
    }
    console.log("update data", data);

    const setClauses = Object.entries(data)
      .map(([field]) => `\`${field}\` = @set_${field}`)
      .join(", ");
    const setValues = Object.entries(data).reduce(
      (acc, [field, value]) => ({ ...acc, [`set_${field}`]: value }),
      {}
    );
    const { clause: whereClause, params: whereValues } = buildWhereClause(
      options.where
    );
    const sql = `UPDATE \`${this.orm.config.dataset}.${
      this.tableName
    }\` SET ${setClauses} WHERE ${whereClause || "TRUE"}`;
    const allParams = { ...setValues, ...whereValues };

    console.log("update SqlQUERY", sql);

    try {
      // Step 1: Create the job
      const [job] = await this.orm.bigquery.createQueryJob({
        query: sql,
        params: allParams,
      });

      // Step 2: Wait for the job to finish
      await job.getQueryResults();

      // Step 3: Fetch complete metadata
      const [metadata] = await job.getMetadata();

      const affectedRows = Number(
        metadata.statistics?.query?.numDmlAffectedRows || 0
      );

      if (this.orm.config.logging)
        console.log(`Updated ${affectedRows} rows in ${this.tableName}`);

      return affectedRows;
    } catch (err: any) {
      if (
        err.message.includes("UPDATE or DELETE statement over table") &&
        err.message.includes("streaming buffer")
      ) {
        throw new Error(
          `Cannot UPDATE rows currently in the streaming buffer for table ${this.tableName}. Please wait a few minutes before retrying.`
        );
      }
      console.error(
        `Failed to update records in ${this.tableName}:`,
        err.message
      );
      throw err;
    }
  }

  static async destroy(options: { where: WhereOptions }): Promise<number> {
    if (this.orm.config.freeTierMode) {
      throw new Error(
        "Free tier mode: DESTROY (DELETE) not allowed. Enable billing at https://console.cloud.google.com/billing."
      );
    }

    const { clause, params } = buildWhereClause(options.where);
    const sql = `DELETE FROM \`${this.orm.config.dataset}.${
      this.tableName
    }\` WHERE ${clause || "TRUE"}`;

    try {
      const [job] = await this.orm.bigquery.createQueryJob({
        query: sql,
        params,
      });
      await job.getQueryResults();
      const [metadata] = await job.getMetadata();
      const affectedRows = Number(
        metadata.statistics?.query?.numDmlAffectedRows || 0
      );

      if (this.orm.config.logging)
        console.log(`Deleted ${affectedRows} rows from ${this.tableName}`);

      return affectedRows;
    } catch (err: any) {
      if (
        err.message.includes("UPDATE or DELETE statement over table") &&
        err.message.includes("streaming buffer")
      ) {
        throw new Error(
          `Cannot DELETE rows currently in the streaming buffer for table ${this.tableName}. Please wait a few minutes before retrying.`
        );
      }
      console.error(
        `Failed to delete records from ${this.tableName}:`,
        err.message
      );
      throw err;
    }
  }

  static async increment(
    fields: string | string[],
    options: { by?: number; where: WhereOptions }
  ): Promise<number> {
    if (this.orm.config.freeTierMode) {
      throw new Error(
        "Free tier mode: INCREMENT (UPDATE) not allowed. Enable billing at https://console.cloud.google.com/billing."
      );
    }
    const by = options.by || 1;
    const fieldArray = Array.isArray(fields) ? fields : [fields];
    const setClauses = fieldArray
      .map((field) => `\`${field}\` = \`${field}\` + ${by}`)
      .join(", ");
    const { clause: whereClause, params: whereValues } = buildWhereClause(
      options.where
    );
    const sql = `UPDATE \`${this.orm.config.dataset}.${
      this.tableName
    }\` SET ${setClauses} WHERE ${whereClause || "TRUE"}`;
    try {
      const [, job] = (await this.orm.bigquery.query({
        query: sql,
        params: whereValues,
      })) as [any, Job];
      const [metadata] = await job.getMetadata();
      const affectedRows = Number(
        metadata.statistics?.query?.numDmlAffectedRows || 0
      );
      if (this.orm.config.logging)
        console.log(`Incremented ${affectedRows} rows in ${this.tableName}`);
      return affectedRows;
    } catch (err: any) {
      console.error(
        `Failed to increment fields in ${this.tableName}:`,
        err.message
      );
      throw err;
    }
  }

  static async decrement(
    fields: string | string[],
    options: { by?: number; where: WhereOptions }
  ): Promise<number> {
    return this.increment(fields, { ...options, by: -(options.by || 1) });
  }

  private static buildSelectQuery(
    options: FindOptions,
    selectOverride?: string
  ): { sql: string; params: Record<string, any> } {
    const dataset = this.orm.config.dataset;
    const mainAlias = this.tableName;
    let sql = `FROM \`${dataset}.${this.tableName}\` AS \`${mainAlias}\``;
    const params: Record<string, any> = {};
    const whereClauses: string[] = [];

    if (options.include) {
      for (const inc of options.include) {
        const as = inc.as || inc.model.tableName;
        const assoc = Object.values(this.associations).find(
          (a) => a.as === as && a.target === inc.model
        );
        if (!assoc)
          throw new Error(`Association not found for ${inc.model.name}`);
        const joinType = inc.required ? "INNER JOIN" : "LEFT OUTER JOIN";
        let joinOn: string;
        if (assoc.type === "belongsTo") {
          joinOn = `\`${mainAlias}\`.\`${assoc.foreignKey}\` = \`${as}\`.\`${inc.model.primaryKey}\``;
          sql += ` ${joinType} \`${dataset}.${inc.model.tableName}\` AS \`${as}\` ON ${joinOn}`;
        } else if (assoc.type === "hasOne" || assoc.type === "hasMany") {
          joinOn = `\`${mainAlias}\`.\`${this.primaryKey}\` = \`${as}\`.\`${assoc.foreignKey}\``;
          sql += ` ${joinType} \`${dataset}.${inc.model.tableName}\` AS \`${as}\` ON ${joinOn}`;
        } else if (assoc.type === "belongsToMany") {
          if (!assoc.through || !assoc.otherKey)
            throw new Error(
              "Through model and otherKey required for belongsToMany"
            );
          const throughAs = `${as}_through`;
          const throughTable = assoc.through.tableName;
          sql += ` ${joinType} \`${dataset}.${throughTable}\` AS \`${throughAs}\` ON \`${mainAlias}\`.\`${this.primaryKey}\` = \`${throughAs}\`.\`${assoc.foreignKey}\``;
          joinOn = `\`${throughAs}\`.\`${assoc.otherKey}\` = \`${as}\`.\`${inc.model.primaryKey}\``;
          sql += ` ${joinType} \`${dataset}.${inc.model.tableName}\` AS \`${as}\` ON ${joinOn}`;
        }

        if (inc.where) {
          const { clause, params: incParams } = buildWhereClause(inc.where);
          const prefixedClause = clause.replace(/`([^`]+)`/g, `\`${as}\`.$1`);
          whereClauses.push(prefixedClause);
          Object.assign(params, incParams);
        }
      }
    }

    let mainWhere = "";
    if (options.where) {
      const { clause, params: mParams } = buildWhereClause(options.where);
      mainWhere = clause;
      Object.assign(params, mParams);
    }

    let whereClause = [mainWhere, ...whereClauses]
      .filter((c) => c)
      .join(" AND ");
    if (whereClause) {
      sql += ` WHERE ${whereClause}`;
    }

    let selectClause: string[] = [];
    if (selectOverride) {
      selectClause.push(selectOverride);
    } else {
      const mainAttributes = options.attributes || Object.keys(this.attributes);
      for (const field of mainAttributes) {
        selectClause.push(
          `\`${mainAlias}\`.\`${field}\` AS \`${mainAlias}_${field}\``
        );
      }
      if (options.include) {
        for (const inc of options.include) {
          const as = inc.as || inc.model.tableName;
          const incAttributes =
            inc.attributes || Object.keys(inc.model.attributes);
          for (const field of incAttributes) {
            selectClause.push(`\`${as}\`.\`${field}\` AS \`${as}_${field}\``);
          }
        }
      }
    }

    sql = `SELECT ${selectClause.join(", ")} ${sql}`;

    if (options.group) {
      sql += ` GROUP BY ${options.group.map((g) => `\`${g}\``).join(", ")}`;
    }

    if (options.order) {
      sql += ` ORDER BY ${options.order
        .map(([field, dir]) => `\`${field}\` ${dir}`)
        .join(", ")}`;
    }

    if (options.limit) {
      sql += ` LIMIT ${options.limit}`;
    }
    if (options.offset) {
      sql += ` OFFSET ${options.offset}`;
    }

    return { sql, params };
  }

  private static nestAssociations(
    rows: any[],
    includes: IncludeOptions[]
  ): any[] {
    if (!includes.length) {
      return rows.map((row) => {
        const result: any = {};
        for (const [key, value] of Object.entries(row)) {
          if (key.startsWith(`${this.tableName}_`)) {
            result[key.replace(`${this.tableName}_`, "")] = value;
          }
        }
        return result;
      });
    }

    const parentMap = new Map<any, any>();
    for (const row of rows) {
      const parentPKValue = row[`${this.tableName}_${this.primaryKey}`];
      if (parentPKValue == null) continue;

      let parent = parentMap.get(parentPKValue);
      if (!parent) {
        parent = {};
        for (const field in this.attributes) {
          parent[field] = row[`${this.tableName}_${field}`];
        }
        for (const inc of includes) {
          const as = inc.as || inc.model.tableName;
          const assoc = Object.values(this.associations).find(
            (a) => a.as === as
          );
          if (assoc) {
            if (assoc.type === "hasMany" || assoc.type === "belongsToMany") {
              parent[as] = [];
            } else {
              parent[as] = null;
            }
          }
        }
        parentMap.set(parentPKValue, parent);
      }

      for (const inc of includes) {
        const as = inc.as || inc.model.tableName;
        const assoc = Object.values(this.associations).find((a) => a.as === as);
        if (!assoc) continue;

        const childPK = row[`${as}_${inc.model.primaryKey}`];
        if (childPK == null) continue;

        const child: any = {};
        for (const field in inc.model.attributes) {
          child[field] = row[`${as}_${field}`];
        }

        if (assoc.type === "hasMany" || assoc.type === "belongsToMany") {
          if (
            !parent[as].some((c: any) => c[inc.model.primaryKey] === childPK)
          ) {
            parent[as].push(child);
          }
        } else {
          parent[as] = child;
        }
      }
    }

    return Array.from(parentMap.values());
  }
}

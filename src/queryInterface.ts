// File: src/queryInterface.ts
import { BigQuery } from "@google-cloud/bigquery";
import { BigQueryORM } from "./bigQueryORM";
import { DataTypes, DataType } from "./dataTypes";
import { dataTypeToSchemaField } from "./utils";

export class QueryInterface {
  constructor(private orm: BigQueryORM) {}

  async createTable(
    tableName: string,
    attributes: Record<string, DataType>,
    options: { partitionBy?: string; clusterBy?: string[] } = {}
  ): Promise<void> {
    const dataset = this.orm.bigquery.dataset(this.orm.config.dataset);
    const [exists] = await dataset.exists();
    if (!exists) {
      await dataset.create();
    }
    const table = dataset.table(tableName);
    const schema = Object.entries(attributes).map(([name, type]) =>
      dataTypeToSchemaField(name, type)
    );
    const createOptions: any = { schema };
    if (options.partitionBy) {
      createOptions.timePartitioning = {
        type: "DAY",
        field: options.partitionBy,
      }; // Extend for other types
    }
    if (options.clusterBy) {
      createOptions.clustering = { fields: options.clusterBy };
    }
    await table.create(createOptions);
  }

  async dropTable(tableName: string): Promise<void> {
    const table = this.orm.bigquery
      .dataset(this.orm.config.dataset)
      .table(tableName);
    const [exists] = await table.exists();
    if (exists) {
      await table.delete();
    }
  }

  async addColumn(
    tableName: string,
    columnName: string,
    type: DataType
  ): Promise<void> {
    const sql = `ALTER TABLE \`${this.orm.config.projectId}.${
      this.orm.config.dataset
    }.${tableName}\` ADD COLUMN \`${columnName}\` ${this.dataTypeToString(
      type
    )}`;
    await this.orm.bigquery.query(sql);
  }

  async removeColumn(tableName: string, columnName: string): Promise<void> {
    const sql = `ALTER TABLE \`${this.orm.config.projectId}.${this.orm.config.dataset}.${tableName}\` DROP COLUMN IF EXISTS \`${columnName}\``;
    await this.orm.bigquery.query(sql);
  }

  async renameColumn(
    tableName: string,
    oldColumnName: string,
    newColumnName: string
  ): Promise<void> {
    const sql = `ALTER TABLE \`${this.orm.config.projectId}.${this.orm.config.dataset}.${tableName}\` RENAME COLUMN \`${oldColumnName}\` TO \`${newColumnName}\``;
    await this.orm.bigquery.query(sql);
  }

  async changeColumn(
    tableName: string,
    columnName: string,
    type: DataType
  ): Promise<void> {
    // BigQuery limited support; use ALTER for compatible changes, else warn/recreate.
    try {
      const sql = `ALTER TABLE \`${this.orm.config.projectId}.${
        this.orm.config.dataset
      }.${tableName}\` ALTER COLUMN \`${columnName}\` SET DATA TYPE ${this.dataTypeToString(
        type
      )}`;
      await this.orm.bigquery.query(sql);
    } catch (err) {
      console.warn(
        "Type change not supported directly; consider manual migration with temp table."
      );
      // Implement temp table logic if needed for flexibility.
    }
  }

  async addPartition(tableName: string, partitionBy: string): Promise<void> {
    // BigQuery tables are partitioned at creation; to add, recreate table.
    console.warn("Partitioning requires table recreation.");
    // Implement recreation logic if scalable.
  }

  async addClustering(tableName: string, clusterBy: string[]): Promise<void> {
    const sql = `ALTER TABLE \`${this.orm.config.projectId}.${
      this.orm.config.dataset
    }.${tableName}\` SET OPTIONS (clustering_fields = '${JSON.stringify(
      clusterBy
    )}')`;
    await this.orm.bigquery.query(sql);
  }

  async query(sql: string, params?: any): Promise<any> {
    return this.orm.bigquery.query({ query: sql, params });
  }

  private dataTypeToString(type: DataType): string {
    if (typeof type === "string") return type;
    if (type.type === "ARRAY")
      return `ARRAY<${this.dataTypeToString(type.items)}>`;
    if (type.type === "STRUCT") {
      return `STRUCT<${Object.entries(type.fields)
        .map(([n, t]) => `\`${n}\` ${this.dataTypeToString(t)}`)
        .join(", ")}>`;
    }
    return "";
  }

  // Add more: addIndex (not directly, but clustering), etc.
}

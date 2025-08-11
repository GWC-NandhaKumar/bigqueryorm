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
    if (this.orm.config.freeTierMode) {
      console.warn(
        "Free tier mode: Table creation counts toward 10GB storage limit."
      );
    }
    const dataset = this.orm.bigquery.dataset(this.orm.config.dataset);
    const [dsExists] = await dataset.exists();
    if (!dsExists) {
      try {
        await dataset.create();
        if (this.orm.config.logging)
          console.log(`Created dataset ${this.orm.config.dataset}`);
      } catch (err: any) {
        console.error(
          `Failed to create dataset ${this.orm.config.dataset}:`,
          err.message
        );
        throw err;
      }
    }
    const table = dataset.table(tableName);
    const [tExists] = await table.exists();
    if (tExists) {
      if (this.orm.config.logging)
        console.log(`Table ${tableName} already exists, skipping creation`);
      return;
    }
    const schema = Object.entries(attributes).map(([name, type]) =>
      dataTypeToSchemaField(name, type)
    );
    const createOptions: any = { schema };
    if (options.partitionBy) {
      createOptions.timePartitioning = {
        type: "DAY",
        field: options.partitionBy,
      };
    }
    if (options.clusterBy) {
      createOptions.clustering = { fields: options.clusterBy };
    }
    try {
      await table.create(createOptions);
      if (this.orm.config.logging) console.log(`Created table ${tableName}`);
    } catch (err: any) {
      console.error(`Failed to create table ${tableName}:`, err.message);
      throw err;
    }
  }

  async dropTable(tableName: string): Promise<void> {
    if (this.orm.config.freeTierMode) {
      console.warn(
        "Free tier mode: Table deletion counts toward storage changes."
      );
    }
    const table = this.orm.bigquery
      .dataset(this.orm.config.dataset)
      .table(tableName);
    const [exists] = await table.exists();
    if (!exists) {
      if (this.orm.config.logging)
        console.log(`Table ${tableName} does not exist, skipping deletion`);
      return;
    }
    try {
      await table.delete();
      if (this.orm.config.logging) console.log(`Deleted table ${tableName}`);
    } catch (err: any) {
      console.error(`Failed to delete table ${tableName}:`, err.message);
      throw err;
    }
  }

  async addColumn(
    tableName: string,
    columnName: string,
    type: DataType
  ): Promise<void> {
    if (this.orm.config.freeTierMode) {
      throw new Error(
        "Free tier mode: ADD COLUMN (DML) not allowed. Enable billing at https://console.cloud.google.com/billing."
      );
    }
    const sql = `ALTER TABLE \`${this.orm.config.projectId}.${
      this.orm.config.dataset
    }.${tableName}\` ADD COLUMN \`${columnName}\` ${this.dataTypeToString(
      type
    )}`;
    try {
      await this.orm.bigquery.query(sql);
      if (this.orm.config.logging)
        console.log(`Added column ${columnName} to ${tableName}`);
    } catch (err: any) {
      console.error(
        `Failed to add column ${columnName} to ${tableName}:`,
        err.message
      );
      throw err;
    }
  }

  async removeColumn(tableName: string, columnName: string): Promise<void> {
    if (this.orm.config.freeTierMode) {
      throw new Error(
        "Free tier mode: DROP COLUMN (DML) not allowed. Enable billing at https://console.cloud.google.com/billing."
      );
    }
    const sql = `ALTER TABLE \`${this.orm.config.projectId}.${this.orm.config.dataset}.${tableName}\` DROP COLUMN IF EXISTS \`${columnName}\``;
    try {
      await this.orm.bigquery.query(sql);
      if (this.orm.config.logging)
        console.log(`Removed column ${columnName} from ${tableName}`);
    } catch (err: any) {
      console.error(
        `Failed to remove column ${columnName} from ${tableName}:`,
        err.message
      );
      throw err;
    }
  }

  async renameColumn(
    tableName: string,
    oldColumnName: string,
    newColumnName: string
  ): Promise<void> {
    if (this.orm.config.freeTierMode) {
      throw new Error(
        "Free tier mode: RENAME COLUMN (DML) not allowed. Enable billing at https://console.cloud.google.com/billing."
      );
    }
    const sql = `ALTER TABLE \`${this.orm.config.projectId}.${this.orm.config.dataset}.${tableName}\` RENAME COLUMN \`${oldColumnName}\` TO \`${newColumnName}\``;
    try {
      await this.orm.bigquery.query(sql);
      if (this.orm.config.logging)
        console.log(
          `Renamed column ${oldColumnName} to ${newColumnName} in ${tableName}`
        );
    } catch (err: any) {
      console.error(
        `Failed to rename column ${oldColumnName} to ${newColumnName} in ${tableName}:`,
        err.message
      );
      throw err;
    }
  }

  async changeColumn(
    tableName: string,
    columnName: string,
    type: DataType
  ): Promise<void> {
    if (this.orm.config.freeTierMode) {
      throw new Error(
        "Free tier mode: ALTER COLUMN (DML) not allowed. Enable billing at https://console.cloud.google.com/billing."
      );
    }
    try {
      const sql = `ALTER TABLE \`${this.orm.config.projectId}.${
        this.orm.config.dataset
      }.${tableName}\` ALTER COLUMN \`${columnName}\` SET DATA TYPE ${this.dataTypeToString(
        type
      )}`;
      await this.orm.bigquery.query(sql);
      if (this.orm.config.logging)
        console.log(`Changed column ${columnName} type in ${tableName}`);
    } catch (err: any) {
      console.warn(
        "Type change not supported directly; consider manual migration with temp table."
      );
      throw err;
    }
  }

  async addPartition(tableName: string, partitionBy: string): Promise<void> {
    console.warn("Partitioning requires table recreation.");
  }

  async addClustering(tableName: string, clusterBy: string[]): Promise<void> {
    if (this.orm.config.freeTierMode) {
      console.warn("Free tier mode: Clustering may incur query costs.");
    }
    const sql = `ALTER TABLE \`${this.orm.config.projectId}.${
      this.orm.config.dataset
    }.${tableName}\` SET OPTIONS (clustering_fields = '${JSON.stringify(
      clusterBy
    )}')`;
    try {
      await this.orm.bigquery.query(sql);
      if (this.orm.config.logging)
        console.log(`Added clustering to ${tableName}`);
    } catch (err: any) {
      console.error(`Failed to add clustering to ${tableName}:`, err.message);
      throw err;
    }
  }

  async query(sql: string, params?: any): Promise<any> {
    if (
      this.orm.config.freeTierMode &&
      sql.trim().toUpperCase().startsWith("INSERT")
    ) {
      throw new Error(
        "Free tier mode: INSERT queries not allowed. Enable billing at https://console.cloud.google.com/billing."
      );
    }
    try {
      const result = await this.orm.bigquery.query({ query: sql, params });
      if (this.orm.config.logging) console.log(`Executed query: ${sql}`);
      return result;
    } catch (err: any) {
      console.error("Query failed:", err.message);
      throw err;
    }
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
}

import { BigQuery } from "@google-cloud/bigquery";
import * as fs from "fs";
import * as path from "path";
import { Model } from "./model";
import { DataType, DataTypes } from "./dataTypes";
import { QueryInterface } from "./queryInterface";
import { dataTypeToSchemaField } from "./utils";

export interface BigQueryORMConfig {
  projectId: string;
  dataset: string;
  keyFilename?: string;
  logging?: boolean;
  freeTierMode?: boolean;
}

export class BigQueryORM {
  public bigquery: BigQuery;
  public config: Required<BigQueryORMConfig>;
  public models: Record<string, typeof Model> = {};
  private queryInterface: QueryInterface;
  private executedMigrations: Set<string> = new Set(); // In-memory migration tracking for free tier

  constructor(config?: Partial<BigQueryORMConfig>) {
    this.config = {
      projectId: config?.projectId || process.env.GOOGLE_CLOUD_PROJECT || "",
      dataset:
        config?.dataset || process.env.BIGQUERY_DATASET || "default_dataset",
      keyFilename:
        config?.keyFilename || process.env.GOOGLE_APPLICATION_CREDENTIALS || "",
      logging: config?.logging ?? false,
      freeTierMode: config?.freeTierMode ?? false,
    };

    if (!this.config.projectId) {
      throw new Error(
        "projectId must be provided via config or GOOGLE_CLOUD_PROJECT env."
      );
    }

    this.bigquery = new BigQuery({
      projectId: this.config.projectId,
      keyFilename: this.config.keyFilename,
    });
    this.queryInterface = new QueryInterface(this);
  }

  async authenticate(): Promise<void> {
    if (this.config.freeTierMode) {
      console.warn(
        "Free tier mode: Limited to SELECT queries within 1TB limit. DML and streaming inserts disabled."
      );
    }
    try {
      await this.bigquery.getDatasets({ maxResults: 1 });
    } catch (err: any) {
      console.error("Authentication failed:", err.message);
      throw err;
    }
  }

  define(
    name: string,
    attributes: Record<string, DataType>,
    options: { tableName?: string; primaryKey?: string } = {}
  ): typeof Model {
    class DynamicModel extends Model {}
    DynamicModel.init(attributes, {
      orm: this,
      tableName: options.tableName,
      primaryKey: options.primaryKey,
    });
    this.models[name] = DynamicModel;
    return DynamicModel;
  }

  async loadModels(modelsPath: string): Promise<void> {
    try {
      const files = fs
        .readdirSync(modelsPath)
        .filter(
          (f) =>
            !f.endsWith(".d.ts") && (f.endsWith(".ts") || f.endsWith(".js"))
        );
      for (const file of files) {
        const modelFunc = (await import(path.resolve(modelsPath, file)))
          .default;
        if (typeof modelFunc === "function") {
          modelFunc(this, DataTypes);
        }
      }

      for (const model of Object.values(this.models)) {
        if ((model as any).associate) {
          (model as any).associate(this.models);
        }
      }
    } catch (err: any) {
      console.error("Failed to load models:", err.message);
      throw err;
    }
  }

  async sync(
    options: { force?: boolean; alter?: boolean } = {}
  ): Promise<void> {
    const { force = false, alter = false } = options;
    if (this.config.freeTierMode && (force || alter)) {
      console.warn(
        "Free tier mode: Table creation/deletion may incur storage costs. Ensure usage stays within 10GB limit."
      );
    }

    const dataset = this.bigquery.dataset(this.config.dataset);
    const [dsExists] = await dataset.exists();
    if (!dsExists) {
      try {
        await dataset.create();
        if (this.config.logging)
          console.log(`Created dataset ${this.config.dataset}`);
      } catch (err: any) {
        console.error(
          `Failed to create dataset ${this.config.dataset}:`,
          err.message
        );
        throw err;
      }
    }

    for (const model of Object.values(this.models)) {
      const table = dataset.table(model.tableName);
      const [tExists] = await table.exists();
      if (tExists && force) {
        try {
          await table.delete();
          if (this.config.logging)
            console.log(`Deleted table ${model.tableName}`);
        } catch (err: any) {
          console.error(
            `Failed to delete table ${model.tableName}:`,
            err.message
          );
          throw err;
        }
      }
      if (!tExists || force) {
        const schema = Object.entries(model.attributes).map(([name, type]) =>
          dataTypeToSchemaField(name, type)
        );
        try {
          await table.create({ schema });
          if (this.config.logging)
            console.log(`Created table ${model.tableName}`);
        } catch (err: any) {
          console.error(
            `Failed to create table ${model.tableName}:`,
            err.message
          );
          throw err;
        }
      } else if (alter) {
        console.warn(
          "Alter sync not supported in free tier; manual migration recommended."
        );
      }
    }
  }

  getQueryInterface(): QueryInterface {
    return this.queryInterface;
  }

  async runMigrations(migrationsPath: string): Promise<void> {
    if (this.config.freeTierMode) {
      console.warn(
        "Free tier mode: Migrations use in-memory tracking to avoid DML. Enable billing at https://console.cloud.google.com/billing for persistent migration tracking."
      );
    }

    const dataset = this.bigquery.dataset(this.config.dataset);
    let [dsExists] = await dataset.exists();
    if (!dsExists) {
      try {
        await dataset.create();
        if (this.config.logging)
          console.log(`Created dataset ${this.config.dataset}`);
      } catch (err: any) {
        console.error(
          `Failed to create dataset ${this.config.dataset}:`,
          err.message
        );
        throw err;
      }
    }

    const metaTable = dataset.table("migrations");
    let [tExists] = await metaTable.exists();
    if (!tExists && !this.config.freeTierMode) {
      try {
        await metaTable.create({
          schema: [
            { name: "name", type: "STRING" },
            { name: "executed_at", type: "TIMESTAMP" },
          ],
        });
        if (this.config.logging) console.log("Created migrations table");
      } catch (err: any) {
        console.error("Failed to create migrations table:", err.message);
        throw err;
      }
    }

    let executed: Set<string>;
    if (this.config.freeTierMode) {
      executed = this.executedMigrations; // Use in-memory tracking
    } else {
      try {
        const [rows] = await this.bigquery.query({
          query: `SELECT name FROM \`${this.config.projectId}.${this.config.dataset}.migrations\` ORDER BY executed_at ASC`,
        });
        executed = new Set(rows.map((r: any) => r.name));
      } catch (err: any) {
        console.error("Failed to query migrations:", err.message);
        throw err;
      }
    }

    const migrationFiles = fs
      .readdirSync(migrationsPath)
      .filter(
        (f) => !f.endsWith(".d.ts") && (f.endsWith(".ts") || f.endsWith(".js"))
      );
    migrationFiles.sort();

    for (const file of migrationFiles) {
      const migrationName = path.basename(file, path.extname(file));
      if (executed.has(migrationName)) {
        if (this.config.logging)
          console.log(`Skipping migration ${migrationName} (already executed)`);
        continue;
      }

      const migrationModule = await import(path.resolve(migrationsPath, file));
      const migration = migrationModule.default || migrationModule;

      try {
        await migration.up(this.queryInterface, this);
        if (this.config.freeTierMode) {
          this.executedMigrations.add(migrationName);
          if (this.config.logging)
            console.log(`Migration ${migrationName} tracked in-memory`);
        } else {
          const sql = `INSERT INTO \`${this.config.projectId}.${this.config.dataset}.migrations\` (name, executed_at) VALUES (@name, @executed_at)`;
          await this.bigquery.query({
            query: sql,
            params: {
              name: migrationName,
              executed_at: new Date().toISOString(),
            },
          });
          if (this.config.logging)
            console.log(`Migration ${migrationName} executed and recorded`);
        }
      } catch (err: any) {
        console.error(`Failed to run migration ${migrationName}:`, err.message);
        throw err;
      }
    }
  }

  async revertLastMigration(migrationsPath: string): Promise<void> {
    if (this.config.freeTierMode) {
      console.warn(
        "Free tier mode: Reverting migrations not supported due to DML restrictions. Enable billing at https://console.cloud.google.com/billing."
      );
      return;
    }

    const metaTable = this.bigquery
      .dataset(this.config.dataset)
      .table("migrations");
    let migrationName: string;
    try {
      const [rows] = await this.bigquery.query({
        query: `SELECT name FROM \`${this.config.projectId}.${this.config.dataset}.migrations\` ORDER BY executed_at DESC LIMIT 1`,
      });
      if (!rows.length) {
        if (this.config.logging) console.log("No migrations to revert");
        return;
      }
      migrationName = rows[0].name;
    } catch (err: any) {
      console.error("Failed to query migrations for revert:", err.message);
      throw err;
    }

    const migrationFiles = fs
      .readdirSync(migrationsPath)
      .filter(
        (f) => !f.endsWith(".d.ts") && (f.endsWith(".ts") || f.endsWith(".js"))
      );
    const migrationFile = migrationFiles.find(
      (f) => path.basename(f, path.extname(f)) === migrationName
    );
    if (!migrationFile) {
      throw new Error(`Migration file not found: ${migrationName}`);
    }

    const migrationModule = await import(
      path.resolve(migrationsPath, migrationFile)
    );
    const migration = migrationModule.default || migrationModule;

    try {
      await migration.down(this.queryInterface, this);
      const sql = `DELETE FROM \`${this.config.projectId}.${this.config.dataset}.migrations\` WHERE name = @migrationName`;
      await this.bigquery.query({ query: sql, params: { migrationName } });
      if (this.config.logging)
        console.log(`Reverted migration ${migrationName}`);
    } catch (err: any) {
      console.error(
        `Failed to revert migration ${migrationName}:`,
        err.message
      );
      throw err;
    }
  }

  async transaction(fn: (qi: QueryInterface) => Promise<void>): Promise<void> {
    if (this.config.freeTierMode) {
      console.warn(
        "Free tier mode: Transactions limited to SELECT queries. DML operations disabled."
      );
    }
    try {
      await fn(this.queryInterface);
    } catch (err: any) {
      if (this.config.logging)
        console.error("Transaction failed:", err.message);
      throw err;
    }
  }
}

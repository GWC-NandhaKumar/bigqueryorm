// File: src/bigQueryORM.ts
import { BigQuery } from "@google-cloud/bigquery";
import * as fs from "fs";
import * as path from "path";
import { Model } from "./model";
import { DataTypes } from "./dataTypes";
import { QueryInterface } from "./queryInterface";
import { dataTypeToSchemaField } from "./utils";

export interface BigQueryORMConfig {
  projectId: string;
  dataset: string;
  keyFilename?: string;
  metaDataset?: string;
  logging?: boolean; // For flexibility
}

export class BigQueryORM {
  public bigquery: BigQuery;
  public config: Required<BigQueryORMConfig>;
  public models: Record<string, typeof Model> = {};
  private queryInterface: QueryInterface;

  constructor(config?: Partial<BigQueryORMConfig>) {
    this.config = {
      projectId: config?.projectId || process.env.GOOGLE_CLOUD_PROJECT || "",
      dataset:
        config?.dataset || process.env.BIGQUERY_DATASET || "default_dataset",
      keyFilename:
        config?.keyFilename || process.env.GOOGLE_APPLICATION_CREDENTIALS || "", // now guaranteed string
      metaDataset: config?.metaDataset || "bigquery_orm_meta",
      logging: config?.logging ?? false,
    };

    if (!this.config.projectId) {
      throw new Error(
        "projectId must be provided via config or GOOGLE_CLOUD_PROJECT env."
      );
    }

    this.bigquery = new BigQuery({
      projectId: this.config.projectId,
      keyFilename: this.config.keyFilename || undefined,
    });
    this.queryInterface = new QueryInterface(this);
  }

  async authenticate(): Promise<void> {
    await this.bigquery.getDatasets({ maxResults: 1 });
  }

  define(
    name: string,
    attributes: Record<string, any>,
    options: { tableName?: string; primaryKey?: string } = {}
  ): typeof Model {
    class DynamicModel extends Model {}
    (DynamicModel as any).init(attributes, {
      orm: this,
      tableName: options.tableName,
      primaryKey: options.primaryKey,
    });
    this.models[name] = DynamicModel;
    return DynamicModel;
  }

  async loadModels(modelsPath: string): Promise<void> {
    const files = fs
      .readdirSync(modelsPath)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
    for (const file of files) {
      const modelFunc = (await import(path.resolve(modelsPath, file))).default;
      if (typeof modelFunc === "function") {
        modelFunc(this, DataTypes);
      }
    }

    // Call associate if defined
    for (const model of Object.values(this.models)) {
      if ((model as any).associate) {
        (model as any).associate(this.models);
      }
    }
  }

  async sync(
    options: { force?: boolean; alter?: boolean } = {}
  ): Promise<void> {
    const { force = false, alter = false } = options;
    const dataset = this.bigquery.dataset(this.config.dataset);
    let [dsExists] = await dataset.exists();
    if (!dsExists) {
      await dataset.create();
    }

    for (const model of Object.values(this.models)) {
      const table = dataset.table(model.tableName);
      const [tExists] = await table.exists();
      if (tExists && force) {
        await table.delete();
      }
      if (!tExists || force) {
        const schema = Object.entries(model.attributes).map(([name, type]) =>
          dataTypeToSchemaField(name, type)
        );
        await table.create({ schema });
      } else if (alter) {
        // Compare and alter schema; implement diff logic for scalability.
        console.warn(
          "Alter sync not fully implemented; manual migration recommended."
        );
      }
    }
  }

  getQueryInterface(): QueryInterface {
    return this.queryInterface;
  }

  async runMigrations(migrationsPath: string): Promise<void> {
    const metaDataset = this.bigquery.dataset(this.config.metaDataset);
    let [exists] = await metaDataset.exists();
    if (!exists) {
      await metaDataset.create();
    }

    const metaTable = metaDataset.table("migrations");
    [exists] = await metaTable.exists();
    if (!exists) {
      await metaTable.create({
        schema: [
          { name: "name", type: "STRING" },
          { name: "executed_at", type: "TIMESTAMP" },
        ],
      });
    }

    const [rows] = await this.bigquery.query({
      query: `SELECT name FROM \`${this.config.projectId}.${this.config.metaDataset}.migrations\` ORDER BY executed_at ASC`,
    });
    const executed = new Set(rows.map((r: any) => r.name));

    const migrationFiles = fs
      .readdirSync(migrationsPath)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
    migrationFiles.sort();

    for (const file of migrationFiles) {
      const migrationName = path.basename(file, path.extname(file));
      if (executed.has(migrationName)) continue;

      const migrationModule = await import(path.resolve(migrationsPath, file));
      const migration = migrationModule.default || migrationModule;

      await migration.up(this.queryInterface, this);

      await metaTable.insert([
        { name: migrationName, executed_at: new Date() },
      ]);
    }
  }

  async revertLastMigration(migrationsPath: string): Promise<void> {
    const metaTable = this.bigquery
      .dataset(this.config.metaDataset)
      .table("migrations");
    const [rows] = await this.bigquery.query({
      query: `SELECT name FROM \`${this.config.projectId}.${this.config.metaDataset}.migrations\` ORDER BY executed_at DESC LIMIT 1`,
    });
    if (!rows.length) return;

    const migrationName = rows[0].name;
    const migrationFiles = fs
      .readdirSync(migrationsPath)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
    const migrationFile = migrationFiles.find(
      (f) => path.basename(f, path.extname(f)) === migrationName
    );
    if (!migrationFile)
      throw new Error(`Migration file not found: ${migrationName}`);

    const migrationModule = await import(
      path.resolve(migrationsPath, migrationFile)
    );
    const migration = migrationModule.default || migrationModule;

    await migration.down(this.queryInterface, this);

    const sql = `DELETE FROM \`${this.config.projectId}.${this.config.metaDataset}.migrations\` WHERE name = '${migrationName}'`;
    await this.bigquery.query(sql);
  }

  // Transaction simulation: Run queries in a batch job.
  async transaction(fn: (qi: QueryInterface) => Promise<void>): Promise<void> {
    // BigQuery no transactions; use job for atomic insert/update, but not full.
    try {
      await fn(this.queryInterface);
    } catch (err) {
      // No rollback; log error.
      if (this.config.logging) console.error("Transaction failed:", err);
      throw err;
    }
  }
}

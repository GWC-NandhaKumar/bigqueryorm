# BigQueryORM

A **Sequelize-inspired ORM** for **Google BigQuery**, built with **TypeScript** and **ES6**.  
It provides a **structured, type-safe** way to interact with BigQuery: defining models, running migrations, managing associations, and building queries — while keeping configuration clean via environment variables.

---

## Features

- **Model Definitions** – Define schemas using a Sequelize-like syntax with BigQuery data types.
- **Migrations** – Manage schema changes with `up` / `down` migrations, tracked in a meta table.
- **Query Interface** – Perform CRUD operations with a familiar API (`findAll`, `create`, `update`, `destroy`).
- **Associations** – Supports `belongsTo`, `hasOne`, `hasMany` (extendable for `belongsToMany`).
- **Where Clause Operators** – Use `Op.gt`, `Op.or`, `Op.like` for expressive filtering.
- **Environment Configs** – `.env` for `projectId`, `dataset`, and credentials.
- **TypeScript Support** – Fully typed with operator enums, schema definitions, and query results.
- **ES6 Modules** – Modern, clean JavaScript/TypeScript syntax.

---

## Installation

```bash
mkdir bigqueryorm
cd bigqueryorm
npm init -y

npm install @google-cloud/bigquery
npm install --save-dev typescript @types/node
```

Copy the source files from the package structure below.

Build:

```bash
npm run build
```

Install in your project:

```bash
npm install /path/to/bigqueryorm
```

For local development:

```bash
npm link
```

---

## Project Structure

```
bigqueryorm/
├── package.json
├── tsconfig.json
├── src/
│   ├── bigQueryORM.ts       # Main ORM initialization
│   ├── dataTypes.ts         # BigQuery type definitions
│   ├── model.ts             # Core model with CRUD methods
│   ├── op.ts                # Operators (Op.gt, Op.or, etc.)
│   ├── queryInterface.ts    # Migrations API
│   ├── utils.ts             # SQL builders & helpers
│   └── index.ts             # Entry point exports
└── README.md
```

---

## Environment Variables

Create `.env`:

```env
GOOGLE_CLOUD_PROJECT=your-project-id
BIGQUERY_DATASET=your-dataset
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

---

## Authentication

The service account must have:

- **BigQuery Data Editor**
- **BigQuery Job User**

---

## Usage Example

### 1. Define Models

`models/user.ts`

```ts
import { BigQueryORM, DataTypes } from "bigqueryorm";

export default (orm: BigQueryORM) => {
  const User = orm.define(
    "User",
    {
      id: DataTypes.INTEGER,
      name: DataTypes.STRING,
      email: DataTypes.STRING,
      age: DataTypes.INTEGER,
    },
    { tableName: "users" }
  );

  // Optional: Associations
  User.associate = (models) => {
    // Example: User.hasMany(models.Post, { foreignKey: 'userId', as: 'posts' });
  };

  return User;
};
```

---

### 2. Create Migrations

`migrations/20240810-create-users.ts`

```ts
import { DataTypes } from "bigqueryorm";

export default {
  async up(queryInterface) {
    await queryInterface.createTable("users", {
      id: DataTypes.INTEGER,
      name: DataTypes.STRING,
      email: DataTypes.STRING,
      age: DataTypes.INTEGER,
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("users");
  },
};
```

---

### 3. Use in Your Application

`index.ts`

```ts
import { BigQueryORM } from "bigqueryorm";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  // Initialize ORM
  const orm = new BigQueryORM({
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    dataset: process.env.BIGQUERY_DATASET,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  await orm.authenticate();
  await orm.loadModels("./models");
  await orm.runMigrations("./migrations");
  await orm.sync({ force: false });

  // Create
  await orm.models.User.create({
    id: 1,
    name: "John Doe",
    email: "john@example.com",
    age: 30,
  });

  // Read
  const users = await orm.models.User.findAll({
    where: { age: { gt: 25 } },
    limit: 10,
  });
  console.log("Users:", users);

  // Update
  await orm.models.User.update({ name: "Jane Doe" }, { where: { id: 1 } });

  // Delete
  await orm.models.User.destroy({ where: { id: 1 } });
}

main().catch(console.error);
```

---

### 4. Run Your Application

```bash
ts-node index.ts
```

---

## Key Features Explained

### **Model Definition**

- Define using `orm.define`
- Supports custom table names & associations.
- Example: `User` maps to `dataset.users` with `id`, `name`, `email`, and `age`.

---

### **Migrations**

- Stored in `/migrations`
- Tracked in meta table `bigquery_orm_meta.migrations`
- Each has `up` (apply) and `down` (revert)
- API: `createTable`, `dropTable`, `addColumn`, etc.
- Only runs pending migrations automatically.

---

### **Querying**

- `findAll` – fetch rows with filtering
- `create` – insert row
- `update` – update matching rows
- `destroy` – delete matching rows
- Operators like `Op.gt`, `Op.eq`, `Op.or`

Example:

```ts
User.findAll({ where: { age: { gt: 25 } } });
// Generates: SELECT * FROM dataset.users WHERE age > @param0
```

---

### **Associations**

- `belongsTo`, `hasOne`, `hasMany`
- Extendable for `belongsToMany`
- Defined inside `.associate` method in model
- Requires custom JOIN logic for eager loading

---

### **Environment Config**

- Uses `.env` file
- Falls back to constructor parameters

---

## Extending the Package

- **Associations**: Implement JOIN logic in `findAll` for `include` queries.
- **Transactions**: BigQuery doesn’t support traditional transactions, but you can emulate with job batching.
- **Indexes**: Use clustering or partitioning.
- **Error Handling**: Add centralized error logger.
- **Additional Methods**: `findOne`, `count`, `findByPk`.

---

## Limitations

- No full transaction support
- Associations are partially implemented
- Schema changes like altering column types require table recreation

---

## Contributing

Pull requests welcome! Add tests, improve associations, or extend migration features.

---

## License

MIT

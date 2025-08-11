# BigQueryORM

BigQueryORM is a lightweight Object-Relational Mapping (ORM) library for Google Cloud BigQuery, inspired by Sequelize but tailored to BigQuery's unique features and limitations. It provides an intuitive API for defining models, managing associations, performing CRUD operations, running migrations, and executing queries while respecting BigQuery's SQL dialect and cost model (including free tier restrictions).

This library is ideal for developers building data-intensive applications on BigQuery without needing full relational database semantics. It handles schema management, query building, and data manipulation, but with caveats for BigQuery's immutable nature (e.g., updates and deletes are DML operations that may incur costs or be restricted).

## Key Features

- **Model Definition**: Define models with attributes using a variety of data types (primitives like STRING, INTEGER; complexes like ARRAY, STRUCT).
- **Associations**: Support for one-to-one (hasOne, belongsTo), one-to-many (hasMany), and many-to-many (belongsToMany) relationships, with eager loading via `include`.
- **CRUD Operations**: Create, read, update, and delete records, including bulk operations. Supports raw queries for flexibility.
- **Query Building**: Advanced querying with `where` conditions (using operators like eq, gt, in, like), ordering, grouping, limiting, offsetting, and nested includes for associations.
- **Schema Management**: Create/drop tables, add/remove/rename/change columns, add partitioning/clustering via the QueryInterface.
- **Migrations**: Script-based migrations with up/down methods. Tracks executed migrations (in-memory for free tier; persistent otherwise).
- **Sync**: Automatically sync models to BigQuery tables, with options for force (drop and recreate) or alter (limited support).
- **Transactions**: Basic transaction support (limited to SELECT in free tier).
- **Free Tier Mode**: Special mode to enforce BigQuery's free tier limits (e.g., no DML like INSERT/UPDATE/DELETE; warns on storage usage). Throws errors for billable operations and suggests enabling billing.
- **Logging**: Optional logging for operations like table creation, queries, and migrations.
- **Authentication**: Integrates with Google Cloud credentials (via env vars or config).
- **Data Types and Operators**: Built-in support for BigQuery data types and query operators (e.g., Op.eq, Op.like, Op.contains).
- **Utils**: Helper functions for schema conversion and where clause building.

## Installation

```bash
npm install bigquery-orm
# or
yarn add bigquery-orm
```

This package depends on `@google-cloud/bigquery`. Ensure you have Google Cloud credentials set up (e.g., via `GOOGLE_APPLICATION_CREDENTIALS` env var).

## Usage

### Configuration

Initialize the ORM with your BigQuery project details:

```typescript
import { BigQueryORM } from "bigquery-orm";

const orm = new BigQueryORM({
  projectId: "your-project-id",
  dataset: "your-dataset",
  keyFilename: "/path/to/credentials.json", // Optional
  logging: true, // Optional
  freeTierMode: true, // Optional: Enable for free tier restrictions
});

await orm.authenticate(); // Verify connection
```

Environment variables like `GOOGLE_CLOUD_PROJECT` and `BIGQUERY_DATASET` can be used as fallbacks.

### Defining Models

Models extend an abstract `Model` class. Define attributes using `DataTypes`:

```typescript
import { BigQueryORM, DataTypes, Model } from "bigquery-orm";

class User extends Model {}

User.init(
  {
    id: DataTypes.INTEGER,
    name: DataTypes.STRING,
    email: DataTypes.STRING,
    createdAt: DataTypes.TIMESTAMP,
    tags: { type: "ARRAY", items: DataTypes.STRING }, // Complex type
    address: {
      type: "STRUCT",
      fields: { street: DataTypes.STRING, city: DataTypes.STRING },
    },
  },
  { orm, tableName: "users", primaryKey: "id" }
);
```

Alternatively, use `orm.define`:

```typescript
const User = orm.define("User", {
  id: DataTypes.INTEGER,
  name: DataTypes.STRING,
});
```

### Associations

Define relationships between models:

```typescript
class Post extends Model {}
Post.init(
  { id: DataTypes.INTEGER, title: DataTypes.STRING, userId: DataTypes.INTEGER },
  { orm }
);

// One-to-Many
User.hasMany(Post, { foreignKey: "userId", as: "posts" });
Post.belongsTo(User, { foreignKey: "userId", as: "user" });

// Many-to-Many (requires a through model)
class UserRole extends Model {}
UserRole.init(
  { userId: DataTypes.INTEGER, roleId: DataTypes.INTEGER },
  { orm }
);

class Role extends Model {}
Role.init({ id: DataTypes.INTEGER, name: DataTypes.STRING }, { orm });

User.belongsToMany(Role, {
  through: UserRole,
  foreignKey: "userId",
  otherKey: "roleId",
  as: "roles",
});
Role.belongsToMany(User, {
  through: UserRole,
  foreignKey: "roleId",
  otherKey: "userId",
  as: "users",
});
```

### Loading Models from Files

Organize models in a directory and load them:

```typescript
await orm.loadModels("./models"); // Expects files exporting a function like (orm, DataTypes) => { ... }
```

Each model file might look like:

```typescript
// models/user.ts
export default (orm, DataTypes) => {
  const User = orm.define("User", {
    /* attributes */
  });
  User.associate = (models) => {
    User.hasMany(models.Post);
  };
  return User;
};
```

### Syncing Schema

Create or update tables based on models:

```typescript
await orm.sync({ force: true }); // Drops and recreates tables
// or
await orm.sync({ alter: true }); // Limited alterations (e.g., warns in free tier)
```

Use QueryInterface for fine-grained control:

```typescript
const qi = orm.getQueryInterface();
await qi.createTable(
  "users",
  { id: DataTypes.INTEGER, name: DataTypes.STRING },
  { partitionBy: "createdAt", clusterBy: ["name"] }
);
await qi.addColumn("users", "age", DataTypes.INTEGER);
await qi.dropTable("users");
```

### CRUD Operations

#### Create

```typescript
const user = await User.create({ name: "John Doe", email: "john@example.com" });
// Bulk
await User.bulkCreate([{ name: "Jane" }, { name: "Bob" }]);
```

#### Read

```typescript
const users = await User.findAll({
  attributes: ["id", "name"],
  where: { age: { [Op.gt]: 18 }, name: { [Op.like]: "%John%" } },
  include: [{ model: Post, as: "posts", where: { title: "Hello" } }],
  order: [["name", "ASC"]],
  limit: 10,
  offset: 0,
  raw: true, // Return flat rows instead of nested
});

const user = await User.findOne({ where: { id: 1 } });
const userByPk = await User.findByPk(1);
const count = await User.count({ where: { age: { [Op.gte]: 18 } } });
```

Supports nested where with AND/OR:

```typescript
where: {
  and: [{ age: { [Op.gt]: 18 } }, { name: { [Op.notLike]: '%Admin%' } }],
}
```

#### Update

```typescript
const updatedCount = await User.update(
  { name: "Updated Name" },
  { where: { id: 1 } }
);

await User.increment("views", { by: 1, where: { id: 1 } });
await User.decrement(["likes", "shares"], { by: 2, where: { id: 1 } });
```

#### Delete

```typescript
const deletedCount = await User.destroy({ where: { id: 1 } });
```

**Note**: In free tier mode, all DML (CREATE/UPDATE/DELETE/INSERT) operations throw errors, as they require billing. Streaming buffer restrictions may cause temporary failures on recent inserts.

### Queries

Execute raw SQL:

```typescript
const qi = orm.getQueryInterface();
const results = await qi.query("SELECT * FROM `dataset.table` WHERE id = @id", {
  id: 1,
});
```

### Migrations

Place migration scripts in a directory (e.g., `./migrations`). Each file exports `up` and `down` functions:

```typescript
// migrations/001-create-users.ts
export default {
  async up(qi, orm) {
    await qi.createTable("users", {
      id: DataTypes.INTEGER,
      name: DataTypes.STRING,
    });
  },
  async down(qi, orm) {
    await qi.dropTable("users");
  },
};
```

Run/revert:

```typescript
await orm.runMigrations("./migrations");
await orm.revertLastMigration("./migrations");
```

In free tier, migrations use in-memory tracking (no persistent table).

### Transactions

```typescript
await orm.transaction(async (qi) => {
  // Perform operations
});
```

Limited in free tier.

## Analysis and Limitations

### Strengths

- **BigQuery-Native**: Leverages BigQuery's strengths like columnar storage, partitioning, and clustering for efficient queries. Handles complex types (ARRAY, STRUCT) seamlessly.
- **Cost-Aware**: Free tier mode prevents accidental billing by blocking DML and warning on storage/query limits (1TB queries/month, 10GB storage).
- **Developer-Friendly**: Familiar API for those coming from Sequelize/ORMs. Automatic query building reduces SQL boilerplate.
- **Extensible**: Raw query support, custom associations, and utils for advanced use cases.
- **Migration System**: Simple script-based migrations with rollback support.

### Weaknesses and Limitations

- **BigQuery Constraints**: BigQuery is not a full RDBMS—updates/deletes are expensive and can't target streaming buffer data (recent inserts). The library throws specific errors for this.
- **Free Tier Restrictions**: No DML (INSERT/UPDATE/DELETE/ALTER); limited to SELECT. Sync/migration may incur storage costs (warned). No persistent migration tracking.
- **Alter Support**: Limited (e.g., no direct type changes without recreation; warns for manual migration).
- **Associations**: Eager loading via JOINs; no lazy loading. BelongsToMany requires a through model.
- **Partitioning/Clustering**: Basic support during creation; adding post-creation requires recreation or manual SQL.
- **Error Handling**: Relies on BigQuery errors; streaming buffer issues may require retries.
- **Performance**: Query building uses string concatenation (safe via params), but complex includes may generate inefficient SQL.
- **No Validation**: No built-in attribute validation (e.g., required fields); handle in app logic.
- **Dependencies**: Requires `@google-cloud/bigquery`; no additional installs allowed in code interpreter env.
- **Testing**: In-memory migration tracking in free tier is session-specific—not persistent across runs.

For production, enable billing for full functionality. Always monitor BigQuery costs via the console.

## Contributing

Contributions welcome! Fork the repo, add features/fixes, and submit a PR. Ensure tests cover new code.

## License

MIT License. See LICENSE file for details.

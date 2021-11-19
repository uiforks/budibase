import {
  DatasourceFieldTypes,
  Integration,
  Operation,
  QueryJson,
  QueryTypes,
  SqlQuery,
} from "../definitions/datasource"
import {
  getSqlQuery,
  buildExternalTableId,
  convertSqlType,
  finaliseExternalTables,
  SqlClients,
} from "./utils"
import { DatasourcePlus } from "./base/datasourcePlus"
import { Table, TableSchema } from "../definitions/common"

module MSSQLModule {
  const sqlServer = require("mssql")
  const Sql = require("./base/sql")

  interface MSSQLConfig {
    user: string
    password: string
    server: string
    port: number
    database: string
    encrypt?: boolean
  }

  const SCHEMA: Integration = {
    docs: "https://github.com/tediousjs/node-mssql",
    plus: true,
    description:
      "Microsoft SQL Server is a relational database management system developed by Microsoft. ",
    friendlyName: "MS SQL Server",
    datasource: {
      user: {
        type: DatasourceFieldTypes.STRING,
        required: true,
        default: "localhost",
      },
      password: {
        type: DatasourceFieldTypes.PASSWORD,
        required: true,
      },
      server: {
        type: DatasourceFieldTypes.STRING,
        default: "localhost",
      },
      port: {
        type: DatasourceFieldTypes.NUMBER,
        required: false,
        default: 1433,
      },
      database: {
        type: DatasourceFieldTypes.STRING,
        default: "root",
      },
      encrypt: {
        type: DatasourceFieldTypes.BOOLEAN,
        default: true,
      },
    },
    query: {
      create: {
        type: QueryTypes.SQL,
      },
      read: {
        type: QueryTypes.SQL,
      },
      update: {
        type: QueryTypes.SQL,
      },
      delete: {
        type: QueryTypes.SQL,
      },
    },
  }

  async function internalQuery(
    client: any,
    query: SqlQuery,
    operation: string | undefined = undefined
  ) {
    const request = client.request()
    try {
      if (Array.isArray(query.bindings)) {
        let count = 0
        for (let binding of query.bindings) {
          request.input(`p${count++}`, binding)
        }
      }
      // this is a hack to get the inserted ID back,
      //  no way to do this with Knex nicely
      const sql =
        operation === Operation.CREATE
          ? `${query.sql}; SELECT SCOPE_IDENTITY() AS id;`
          : query.sql
      return await request.query(sql)
    } catch (err) {
      // @ts-ignore
      throw new Error(err)
    }
  }

  class SqlServerIntegration extends Sql implements DatasourcePlus {
    private readonly config: MSSQLConfig
    static pool: any
    public tables: Record<string, Table> = {}
    public schemaErrors: Record<string, string> = {}

    MASTER_TABLES = [
      "spt_fallback_db",
      "spt_fallback_dev",
      "spt_fallback_usg",
      "spt_monitor",
      "MSreplication_options",
    ]
    TABLES_SQL =
      "SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'"

    getDefinitionSQL(tableName: string) {
      return `select *
              from INFORMATION_SCHEMA.COLUMNS
              where TABLE_NAME='${tableName}'`
    }

    getConstraintsSQL(tableName: string) {
      return `SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS TC 
              INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS KU
                ON TC.CONSTRAINT_TYPE = 'PRIMARY KEY' 
                AND TC.CONSTRAINT_NAME = KU.CONSTRAINT_NAME 
                AND KU.table_name='${tableName}'
              ORDER BY 
                KU.TABLE_NAME,
                KU.ORDINAL_POSITION;`
    }

    getAutoColumnsSQL(tableName: string) {
      return `SELECT 
              COLUMNPROPERTY(OBJECT_ID(TABLE_SCHEMA+'.'+TABLE_NAME),COLUMN_NAME,'IsComputed') 
                AS IS_COMPUTED,
              COLUMNPROPERTY(object_id(TABLE_SCHEMA+'.'+TABLE_NAME), COLUMN_NAME, 'IsIdentity')
                AS IS_IDENTITY,
              *
              FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_NAME='${tableName}'`
    }

    constructor(config: MSSQLConfig) {
      super(SqlClients.MS_SQL)
      this.config = config
      const clientCfg = {
        ...this.config,
        options: {
          encrypt: this.config.encrypt,
          enableArithAbort: true,
        },
      }
      delete clientCfg.encrypt
      if (!this.pool) {
        this.pool = new sqlServer.ConnectionPool(clientCfg)
      }
    }

    async connect() {
      try {
        this.client = await this.pool.connect()
      } catch (err) {
        // @ts-ignore
        throw new Error(err)
      }
    }

    async runSQL(sql: string) {
      return (await internalQuery(this.client, getSqlQuery(sql))).recordset
    }

    /**
     * Fetches the tables from the sql server database and assigns them to the datasource.
     * @param {*} datasourceId - datasourceId to fetch
     * @param entities - the tables that are to be built
     */
    async buildSchema(datasourceId: string, entities: Record<string, Table>) {
      await this.connect()
      let tableNames = await this.runSQL(this.TABLES_SQL)
      if (tableNames == null || !Array.isArray(tableNames)) {
        throw "Unable to get list of tables in database"
      }
      tableNames = tableNames
        .map((record: any) => record.TABLE_NAME)
        .filter((name: string) => this.MASTER_TABLES.indexOf(name) === -1)

      const tables: Record<string, Table> = {}
      for (let tableName of tableNames) {
        // get the column definition (type)
        const definition = await this.runSQL(this.getDefinitionSQL(tableName))
        // find primary key constraints
        const constraints = await this.runSQL(this.getConstraintsSQL(tableName))
        // find the computed and identity columns (auto columns)
        const columns = await this.runSQL(this.getAutoColumnsSQL(tableName))
        const primaryKeys = constraints
          .filter(
            (constraint: any) => constraint.CONSTRAINT_TYPE === "PRIMARY KEY"
          )
          .map((constraint: any) => constraint.COLUMN_NAME)
        const autoColumns = columns
          .filter((col: any) => col.IS_COMPUTED || col.IS_IDENTITY)
          .map((col: any) => col.COLUMN_NAME)

        let schema: TableSchema = {}
        for (let def of definition) {
          const name = def.COLUMN_NAME
          if (typeof name !== "string") {
            continue
          }
          const type: string = convertSqlType(def.DATA_TYPE)

          schema[name] = {
            autocolumn: !!autoColumns.find((col: string) => col === name),
            name: name,
            type,
          }
        }
        tables[tableName] = {
          _id: buildExternalTableId(datasourceId, tableName),
          primary: primaryKeys,
          name: tableName,
          schema,
        }
      }
      const final = finaliseExternalTables(tables, entities)
      this.tables = final.tables
      this.schemaErrors = final.errors
    }

    async read(query: SqlQuery | string) {
      await this.connect()
      const response = await internalQuery(this.client, getSqlQuery(query))
      return response.recordset
    }

    async create(query: SqlQuery | string) {
      await this.connect()
      const response = await internalQuery(this.client, getSqlQuery(query))
      return response.recordset || [{ created: true }]
    }

    async update(query: SqlQuery | string) {
      await this.connect()
      const response = await internalQuery(this.client, getSqlQuery(query))
      return response.recordset || [{ updated: true }]
    }

    async delete(query: SqlQuery | string) {
      await this.connect()
      const response = await internalQuery(this.client, getSqlQuery(query))
      return response.recordset || [{ deleted: true }]
    }

    async query(json: QueryJson) {
      await this.connect()
      const operation = this._operation(json)
      const queryFn = (query: any, op: string) =>
        internalQuery(this.client, query, op)
      const processFn = (result: any) =>
        result.recordset ? result.recordset : [{ [operation]: true }]
      return this.queryWithReturning(json, queryFn, processFn)
    }
  }

  module.exports = {
    schema: SCHEMA,
    integration: SqlServerIntegration,
  }
}

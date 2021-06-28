import {
  getScope,
  userEncryptedKeyPkey,
  encryptedBlobPkey,
} from "@core/lib/blob";
import { env } from "./env";
import { Api } from "@core/types";
import * as R from "ramda";
import { createPool, Connection } from "mysql2/promise";

import { log, logWithElapsed } from "@core/lib/utils/logger";

let maxPacketSize = 4000000; // just a default, will be ovewritten by `max_allowed_packet` setting from db on init

const dbCredentials = JSON.parse(env.DATABASE_CREDENTIALS_JSON) as {
  user: string;
  password: string;
};

export const poolConfig = {
    ...dbCredentials,
    host: env.DATABASE_HOST,
    database: env.DATABASE_NAME,
    port: env.DATABASE_PORT ? parseInt(env.DATABASE_PORT) : undefined,
    multipleStatements: true,
    charset: "utf8mb4",
  },
  pool = createPool(poolConfig),
  graphKey = (
    orgId: string,
    type: Api.Graph.GraphObject["type"],
    id?: string
  ): Api.Db.DbKey => {
    const skey = ["g", type, id].filter(Boolean).join("|");
    return { pkey: orgId, skey };
  },
  // Returns a single row as an object of type T
  getDb = async <T extends Api.Db.DbObject>(
    key: Api.Db.DbKey,
    opts: {
      deleted?: boolean;
    } = {}
  ) => {
    const { deleted } = opts;
    let qs = `SELECT ${"body, data, createdAt, updatedAt, deletedAt, orderIndex, secondaryIndex"} from objects WHERE pkey = ? AND skey = ?`;
    if (deleted === true) {
      qs += " AND deletedAt > 0";
    } else if (deleted === false) {
      qs += " AND deletedAt = 0";
    }

    qs += ";";

    const [rows] = (<any>await pool.query(qs, [key.pkey, key.skey])) as [
      {
        body: string;
        data: string | null;
        createdAt: number;
        updatedAt: number;
        deletedAt: number | null;
        orderIndex: number | null;
        secondaryIndex: string | null;
      }[]
    ];

    if (rows.length == 1) {
      return {
        ...key,
        ...JSON.parse(rows[0].body),
        data: rows[0].data ? JSON.parse(rows[0].data) : undefined,
        createdAt: rows[0].createdAt,
        updatedAt: rows[0].updatedAt,
        deletedAt: rows[0].deletedAt === null ? undefined : rows[0].deletedAt,
        orderIndex:
          rows[0].orderIndex === null ? undefined : rows[0].orderIndex,
        secondaryIndex:
          rows[0].secondaryIndex === null ? undefined : rows[0].secondaryIndex,
      } as T;
    } else {
      return undefined;
    }
  },
  getActiveOrgGraphObjects = async (
    orgId: string,
    readOpts: Api.Db.DbReadOpts = {}
  ) =>
    query<Api.Graph.GraphObject>({
      pkey: orgId,
      scope: "g|",
      sortBy: "orderIndex,createdAt",
      ...readOpts,
    }),
  getDeletedOrgGraphObjects = async (
    orgId: string,
    startsAt: number,
    endsAt?: number
  ) =>
    query<Api.Graph.GraphObject>({
      pkey: orgId,
      scope: "g|",
      deletedAfter: startsAt - 1,
      createdBefore: endsAt ? endsAt + 1 : undefined,
      deleted: true,
      deletedGraphQuery: true,
    }),
  query = async <T extends Api.Db.DbObject>({
    pkey,
    scope,
    limit,
    offset,
    deleted,
    createdBefore,
    createdAfter,
    deletedBefore,
    deletedAfter,
    updatedAfter,
    sortBy,
    sortDesc,
    omitData,
    transactionConn,
    lockType,
    secondaryIndex,
    deletedGraphQuery,
  }: Api.Db.QueryParams) => {
    const fields = [
      "pkey",
      "skey",
      "body",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "orderIndex",
      "secondaryIndex",
    ];

    if (!omitData) {
      fields.push("data");
    }

    let qs = `SELECT ${fields.join(",")} from objects WHERE `;
    const qargs = [];

    if (pkey) {
      if (Array.isArray(pkey)) {
        qs += "(" + pkey.map((s) => "pkey = ?").join(" OR ") + ")";
        for (let s of pkey) {
          qargs.push(s);
        }
      } else {
        qs += "pkey = ?";
        qargs.push(pkey);
      }
    }

    if (scope) {
      if (pkey) {
        qs += " AND ";
      }
      if (Array.isArray(scope)) {
        qs += "(" + scope.map((s) => "skey LIKE ?").join(" OR ") + ")";
        for (let s of scope) {
          qargs.push(s + "%");
        }
      } else {
        qs += "skey LIKE ?";
        qargs.push(scope + "%");
      }
    }

    if (typeof createdBefore == "number") {
      qs += " AND createdAt < ?";
      qargs.push(createdBefore);
    }

    if (typeof createdAfter == "number") {
      qs += " AND createdAt > ?";
      qargs.push(createdAfter);
    }

    if (deleted === true) {
      qs += ` AND deletedAt > ?`;
      qargs.push(deletedAfter ?? 0);
      if (typeof deletedBefore == "number") {
        qs += ` AND deletedAt < ?`;
        qargs.push(deletedBefore);
      }
      if (deletedGraphQuery) {
        qs += ` AND excludeFromDeletedGraph = ?`;
        qargs.push(0);
      }
    } else if (deleted === false || typeof deleted == "undefined") {
      qs += " AND deletedAt = 0";
    }

    if (typeof updatedAfter == "number") {
      qs += " AND updatedAt > ?";
      qargs.push(updatedAfter);
    }

    if (typeof secondaryIndex != "undefined") {
      if (secondaryIndex === null) {
        qs += " AND secondaryIndex IS NULL";
      } else if (typeof secondaryIndex == "string") {
        qs += " AND secondaryIndex = ?";
        qargs.push(secondaryIndex);
      } else if (Array.isArray(secondaryIndex)) {
        qs += " AND secondaryIndex IN (?)";
        qargs.push(secondaryIndex);
      }
    }

    if (sortBy) {
      qs += ` ORDER BY ${sortBy} ${sortDesc ? "DESC" : "ASC"}`;
    }

    if (limit) {
      qs += ` LIMIT ${limit}`;
    }
    if (offset) {
      qs += ` OFFSET ${offset}`;
    }

    if (transactionConn && lockType) {
      qs += " " + lockType;
    }

    qs += ";";

    const conn = transactionConn ?? pool,
      [rows] = (<any>await (conn.query as typeof pool.query)(qs, qargs)) as [
        {
          body: string;
          data?: string | null;
          pkey: string;
          skey: string;
          createdAt: number;
          updatedAt: number;
          deletedAt: number | null;
          orderIndex: number | null;
          secondaryIndex: string | null;
        }[]
      ];

    return rows.map(
      ({
        pkey,
        skey,
        body,
        data,
        createdAt,
        updatedAt,
        deletedAt,
        orderIndex,
        secondaryIndex,
      }) =>
        ({
          ...JSON.parse(body),
          pkey,
          skey,
          createdAt,
          updatedAt,
          deletedAt: deletedAt === null ? undefined : deletedAt,
          orderIndex: orderIndex === null ? undefined : orderIndex,
          secondaryIndex: secondaryIndex === null ? undefined : secondaryIndex,
          data: data ? JSON.parse(data) : undefined,
        } as T)
    );
  },
  putDbStatement = <T extends Api.Db.DbObject>(obj: T): Api.Db.SqlStatement => {
    return {
      qs: `SET @pkey = ?, @skey = ?, @body = ?, @data = ?, @createdAt = ?, @updatedAt = ?, @orderIndex = ?, @secondaryIndex = ?, @excludeFromDeletedGraph = ?;
      SET @fullKey = CONCAT_WS("|",@pkey,@skey);
  INSERT INTO objects (pkey, skey, fullKey, body, data, createdAt, updatedAt, orderIndex, secondaryIndex, excludeFromDeletedGraph)
  VALUES (@pkey, @skey, @fullKey, @body, @data, @createdAt, @updatedAt, @orderIndex, @secondaryIndex, @excludeFromDeletedGraph)
  ON DUPLICATE KEY UPDATE fullKey = @fullKey, body = @body, data = @data, orderIndex = @orderIndex, secondaryIndex = @secondaryIndex, excludeFromDeletedGraph = @excludeFromDeletedGraph, updatedAt = @updatedAt;`,
      qargs: [
        obj.pkey,
        obj.skey,
        JSON.stringify(
          R.omit(
            [
              "pkey",
              "skey",
              "createdAt",
              "updatedAt",
              "deletedAt",
              "orderIndex",
              "data",
              "secondaryIndex",
              "excludeFromDeletedGraph",
            ],
            obj
          )
        ),
        obj.data ? JSON.stringify(obj.data) : null,
        obj.createdAt,
        obj.updatedAt,
        obj.orderIndex ?? null,
        obj.secondaryIndex ?? null,
        obj.excludeFromDeletedGraph ? 1 : 0,
      ],
    };
  },
  putDb = async <T extends Api.Db.DbObject>(obj: T) => {
    const { qs, qargs } = putDbStatement(obj);
    return pool.query(qs, qargs);
  },
  updateDbStatement = <T extends Api.Db.DbObject>(
    key: Api.Db.DbKey,
    obj: T
  ): Api.Db.SqlStatement => ({
    qs: "UPDATE objects SET body = ?, data = ?, updatedAt = ?, deletedAt = ?, orderIndex = ?, secondaryIndex = ?, excludeFromDeletedGraph = ? WHERE pkey = ? AND skey = ?;",
    qargs: [
      JSON.stringify(
        R.omit(
          [
            "pkey",
            "skey",
            "createdAt",
            "updatedAt",
            "deletedAt",
            "orderIndex",
            "data",
            "secondaryIndex",
            "excludeFromDeletedGraph",
          ],
          obj
        )
      ),
      obj.data ? JSON.stringify(obj.data) : null,
      obj.updatedAt,
      obj.deletedAt ?? 0,
      obj.orderIndex ?? null,
      obj.secondaryIndex ?? null,
      obj.excludeFromDeletedGraph ? 1 : 0,
      key.pkey,
      key.skey,
    ],
  }),
  objectTransactionStatements = (
    transactionItems: Api.Db.ObjectTransactionItems,
    now: number
  ): Api.Db.SqlStatement[] => {
    const statements: Api.Db.SqlStatement[] = [];

    const toPutFullKeys = new Set<string>();
    if (transactionItems.puts?.length) {
      for (let obj of transactionItems.puts) {
        toPutFullKeys.add([obj.pkey, obj.skey].join("|"));
      }
    }

    if (transactionItems.softDeleteKeys?.length) {
      const fullKeys = new Set<string>();
      for (let { pkey, skey } of transactionItems.softDeleteKeys) {
        const fullKey = [pkey, skey].join("|");
        if (!toPutFullKeys.has(fullKey)) {
          fullKeys.add(fullKey);
        }
      }

      const qs = "UPDATE objects SET deletedAt = ? WHERE fullKey IN (?);";
      const qargs = [now, Array.from(fullKeys)];
      statements.push({ qs, qargs });
    }

    if (transactionItems.hardDeleteKeys?.length) {
      const fullKeys = new Set<string>();
      for (let { pkey, skey } of transactionItems.hardDeleteKeys) {
        const fullKey = [pkey, skey].join("|");
        if (!toPutFullKeys.has(fullKey)) {
          fullKeys.add(fullKey);
        }
      }
      const qs = "DELETE FROM objects WHERE fullKey IN (?);";
      const qargs = [Array.from(fullKeys)];
      statements.push({ qs, qargs });
    }

    if (transactionItems.hardDeleteEncryptedKeyParams?.length) {
      for (let params of transactionItems.hardDeleteEncryptedKeyParams) {
        const pkey = userEncryptedKeyPkey(params),
          scope = getScope(params);
        let qs = "DELETE FROM objects WHERE pkey = ?";
        const qargs = [pkey];

        if (scope) {
          qs += " AND skey LIKE ?;";
          qargs.push(scope + "%");
        } else {
          qs += ";";
        }
        statements.push({ qs, qargs });
      }
    }

    if (transactionItems.hardDeleteEncryptedBlobParams?.length) {
      for (let params of transactionItems.hardDeleteEncryptedBlobParams) {
        const pkey = encryptedBlobPkey(params),
          scope = getScope(params);
        let qs = "DELETE FROM objects WHERE pkey = ?";
        const qargs = [pkey];

        if (scope) {
          qs += " AND skey LIKE ?;";
          qargs.push(scope + "%");
        } else {
          qs += ";";
        }
        statements.push({ qs, qargs });
      }
    }

    if (transactionItems.softDeleteScopes?.length) {
      for (let { pkey, scope } of transactionItems.softDeleteScopes) {
        let qs = "UPDATE objects SET deletedAt = ? WHERE pkey = ?";
        const qargs = [now, pkey];
        if (scope) {
          qs += " AND skey LIKE ?;";
          qargs.push(scope + "%");
        } else {
          qs += ";";
        }
        statements.push({ qs, qargs });
      }
    }

    if (transactionItems.hardDeleteScopes?.length) {
      for (let { pkey, scope } of transactionItems.hardDeleteScopes) {
        let qs = "DELETE FROM OBJECTS WHERE pkey = ?";
        const qargs = [pkey];
        if (scope) {
          qs += " AND skey LIKE ?;";
          qargs.push(scope + "%");
        } else {
          qs += ";";
        }
        statements.push({ qs, qargs });
      }
    }

    if (transactionItems.puts?.length) {
      for (let obj of transactionItems.puts) {
        statements.push(putDbStatement(obj));
      }
    }

    if (transactionItems.updates?.length) {
      for (let [key, obj] of transactionItems.updates) {
        statements.push(updateDbStatement(key, obj));
      }
    }

    if (transactionItems.orderUpdateScopes?.length) {
      for (let [
        { pkey, scope },
        orderIndex,
      ] of transactionItems.orderUpdateScopes) {
        const qs =
          "UPDATE objects SET orderIndex = ? WHERE pkey = ? AND skey LIKE ?;";
        const qargs = [orderIndex, pkey, scope + "%"];
        statements.push({ qs, qargs });
      }
    }

    return statements;
  },
  executeTransactionStatements = async (
    statements: Api.Db.SqlStatement[],
    transactionConn?: Connection
  ) => {
    let qs: string = transactionConn ? "" : "START TRANSACTION;",
      qargs: any[] = [];

    let packetSize = 0;

    const totalSize = Buffer.byteLength(JSON.stringify(statements), "utf8");
    log(
      `executing SQL statements | ${statements.length} statements | total size ${totalSize} bytes`
    );

    for (let statement of statements) {
      const statementSize = Buffer.byteLength(
        JSON.stringify(statement),
        "utf8"
      );

      if (statementSize > maxPacketSize) {
        const msg = `SQL statement of size ${statementSize} bytes exceeds maximum packet size of ${maxPacketSize} bytes`;
        log(msg);
        throw new Error(msg);
      }

      if (transactionConn && packetSize + statementSize > maxPacketSize) {
        await transactionConn.query(qs, qargs);
        qs = "";
        qargs = [];
        packetSize = 0;
      }

      qs += statement.qs;
      qargs = qargs.concat(statement.qargs);
      packetSize += statementSize;
    }

    qs += "COMMIT;";
    return (transactionConn ?? pool).query(qs, qargs);
  },
  mergeObjectTransactionItems = (
    transactionItemsList: Api.Db.ObjectTransactionItems[]
  ) => {
    let res: Api.Db.ObjectTransactionItems = {};

    for (let transactionItems of transactionItemsList) {
      if (transactionItems.softDeleteKeys) {
        res.softDeleteKeys = (res.softDeleteKeys ?? []).concat(
          transactionItems.softDeleteKeys
        );
      }

      if (transactionItems.hardDeleteKeys) {
        res.hardDeleteKeys = (res.hardDeleteKeys ?? []).concat(
          transactionItems.hardDeleteKeys
        );
      }

      if (transactionItems.hardDeleteEncryptedKeyParams) {
        res.hardDeleteEncryptedKeyParams = (
          res.hardDeleteEncryptedKeyParams ?? []
        ).concat(transactionItems.hardDeleteEncryptedKeyParams);
      }

      if (transactionItems.hardDeleteEncryptedBlobParams) {
        res.hardDeleteEncryptedBlobParams = (
          res.hardDeleteEncryptedBlobParams ?? []
        ).concat(transactionItems.hardDeleteEncryptedBlobParams);
      }

      if (transactionItems.softDeleteScopes) {
        res.softDeleteScopes = (res.softDeleteScopes ?? []).concat(
          transactionItems.softDeleteScopes
        );
      }

      if (transactionItems.hardDeleteScopes) {
        res.hardDeleteScopes = (res.hardDeleteScopes ?? []).concat(
          transactionItems.hardDeleteScopes
        );
      }

      if (transactionItems.puts) {
        res.puts = (res.puts ?? []).concat(transactionItems.puts);
      }

      if (transactionItems.updates) {
        res.updates = (res.updates ?? []).concat(transactionItems.updates);
      }

      if (transactionItems.orderUpdateScopes) {
        res.orderUpdateScopes = (res.orderUpdateScopes ?? []).concat(
          transactionItems.orderUpdateScopes
        );
      }
    }

    return res;
  },
  objectTransactionItemsEmpty = (
    transactionItems: Api.Db.ObjectTransactionItems
  ) =>
    (transactionItems.softDeleteKeys?.length ?? 0) +
      (transactionItems.hardDeleteKeys?.length ?? 0) +
      (transactionItems.hardDeleteEncryptedKeyParams?.length ?? 0) +
      (transactionItems.softDeleteScopes?.length ?? 0) +
      (transactionItems.hardDeleteScopes?.length ?? 0) +
      (transactionItems.puts?.length ?? 0) +
      (transactionItems.updates?.length ?? 0) +
      (transactionItems.orderUpdateScopes?.length ?? 0) ===
    0,
  setMaxPacketSize = async () => {
    const res = await pool.query("SELECT @@GLOBAL.max_allowed_packet;");
    const [[{ "@@GLOBAL.max_allowed_packet": dbMaxAllowedPacket }]] = res as [
      any[],
      any
    ];
    maxPacketSize = dbMaxAllowedPacket * 0.95; // leave a little breathing room
    log("Set maxPacketSize:", { maxPacketSize });
  };

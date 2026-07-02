# OpenTelemetry OracleDB Instrumentation for Node.js

[![NPM Published Version][npm-img]][npm-url]
[![Apache License][license-image]][license-image]

This module provides automatic instrumentation for the
[`oracledb`](https://www.npmjs.com/package/oracledb) module, which may be
loaded using the
[`@opentelemetry/sdk-trace-node`](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-sdk-trace-node)
package and is included in the
[`@opentelemetry/auto-instrumentations-node`](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node)
bundle.

If total installation size is not constrained, it is recommended to use the
[`@opentelemetry/auto-instrumentations-node`](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node)
bundle with
[`@opentelemetry/sdk-node`](https://www.npmjs.com/package/@opentelemetry/sdk-node)
for the most seamless instrumentation experience.

Compatible with OpenTelemetry JS API and SDK `1.0+`.

## Installation

```bash
npm install --save @opentelemetry/instrumentation-oracledb
```

## Supported Versions

- [`oracledb`](https://www.npmjs.com/package/oracledb) versions `>=6.7.0 <8`

## Usage

```js
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { OracleInstrumentation } = require('@opentelemetry/instrumentation-oracledb');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');

const provider = new NodeTracerProvider();
provider.register();

registerInstrumentations({
  instrumentations: [
    new OracleInstrumentation(),
  ],
});
```

This instrumentation supports both Thin and Thick mode in `oracledb`.

### Span Types Created

This instrumentation creates spans for connection establishment, query
execution, and LOB operations.

| Span Name | Description | When Created |
| --------- | ----------- | ------------ |
| `oracledb.getConnection` | Standalone connection acquisition | When `oracledb.getConnection()` is called |
| `oracledb.createPool` | Pool creation | When `oracledb.createPool()` is called |
| `oracledb.Pool.getConnection` | Pool connection acquisition | When `pool.getConnection()` is called |
| `oracledb.Connection.execute:<OPERATION> <db.namespace>` | SQL execution | When `connection.execute()` is called |
| `oracledb.Connection.executeMany:<OPERATION> <db.namespace>` | Batch SQL execution | When `connection.executeMany()` is called |
| `oracledb.Connection.close` | Connection close | When `connection.close()` is called |
| `oracledb.Connection.createLob` | Temporary LOB creation | When `connection.createLob()` is called |
| `oracledb.Lob.getData` | LOB data read | When `lob.getData()` is called |

For Thin mode, additional internal round-trip spans may be emitted, such as:

- `oracledb.FastAuthMessage`
- `oracledb.AuthMessage`
- `oracledb.ProtocolMessage`
- `oracledb.DataTypeMessage`
- `oracledb.ExecuteMessage`
- `oracledb.LogOffMessage`
- `oracledb.LobOpMessage`

### OracleDB Instrumentation Options

| Options | Type | Default | Description |
| ------- | ---- | ------- | ----------- |
| [`enhancedDatabaseReporting`](./src/types.ts#L58) | `boolean` | `false` | If true, adds SQL bind values as `db.operation.parameter.<key>` attributes. When enabled, it also records `db.query.text`. This can capture sensitive data and should be used with care. |
| [`dbStatementDump`](./src/types.ts#L67) | `boolean` | `false` | If true, records the SQL statement as `db.query.text`. |
| [`requestHook`](./src/types.ts#L76) | `OracleInstrumentationExecutionRequestHook` | `undefined` | Hook for adding custom span attributes based on the query input and connection metadata. |
| [`responseHook`](./src/types.ts#L84) | `OracleInstrumentationExecutionResponseHook` | `undefined` | Hook for adding custom span attributes based on the database response. |
| [`requireParentSpan`](./src/types.ts#L92) | `boolean` | `false` | If true, only creates spans when there is an active parent span. |
| [`propagateTraceContextToSessionAction`](./src/types.ts#L99) | `boolean` | `false` | If true, injects W3C Trace Context into the Oracle `V$SESSION.ACTION` field so database-side tracing can be correlated with application spans. |

## OracleDB-specific Notes

- Thin mode emits internal round-trip spans. Thick mode does not.
- Thick mode does not expose the same low-level network metadata, so attributes
  such as `server.address`, `server.port`, and `network.transport` may be
  missing.
- Oracle connection metadata such as `oracle.db.name`,
  `oracle.db.instance.name`, `oracle.db.pdb`, `oracle.db.domain`, and the final
  effective `oracle.db.service` are only available after connection metadata has
  been resolved by the driver.
- Failed logins may still include the attempted service name, which is useful
  for debugging connection issues.

## Semantic Conventions

Prior to stable Database semantic conventions, this instrumentation used older
database attributes such as `db.user`, `db.statement`, and an Oracle-specific
`db.namespace` meaning that combined multiple connection properties.

Database semantic conventions were stabilized in v1.34.0, and a
[migration process](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/non-normative/db-migration.md)
was defined. `@opentelemetry/instrumentation-oracledb` supports migration using
the `OTEL_SEMCONV_STABILITY_OPT_IN` environment variable.
The intent is to provide an approximate 6 month time window for users of this
instrumentation to migrate to the new Database semconv, after which a new minor
version will use the new semconv by default and drop support for the old
semconv.

To select which semconv version(s) are emitted from this instrumentation, use:

- `database`: emit the new stable Database semantic conventions
- `database/dup`: emit both old and stable Database semantic conventions where possible
- By default, if `OTEL_SEMCONV_STABILITY_OPT_IN` includes neither token, the old semconv is used

### Attributes collected

| Old semconv | Stable semconv | Short Description |
| ----------- | -------------- | ----------------- |
| `db.user` | Removed | Database user name |
| `db.statement` | `db.query.text` | SQL text |
| `db.system` | `db.system.name` | Database product identifier |
| `net.peer.name` | `server.address` | Remote database host |
| `net.peer.port` | `server.port` | Remote database port |
| `db.namespace=<instance|pdb|service>` | `db.namespace=<dbUniqueName>` | Oracle database namespace |
| (not included) | `oracle.db.name` | Database name |
| (not included) | `oracle.db.instance.name` | Oracle instance name |
| (not included) | `oracle.db.pdb` | Pluggable database name |
| (not included) | `oracle.db.domain` | Database domain |
| (not included) | `oracle.db.service` | Effective Oracle service name |

### `db.namespace` migration note

OracleDB has a special migration constraint: both the old and stable
definitions use the same `db.namespace` key with different meanings.

- Old meaning: a concatenated value derived from instance name, PDB name, and
  service name
- Stable meaning: the Oracle database unique identifier (`DB_UNIQUE_NAME`)

Because a span cannot carry two different values for the same attribute key,
`OTEL_SEMCONV_STABILITY_OPT_IN=database/dup` keeps the old `db.namespace`
meaning while also emitting the new `oracle.db.*` attributes. To switch
`db.namespace` itself to the stable meaning, use:

```bash
OTEL_SEMCONV_STABILITY_OPT_IN=database
```

### Upgrading Semantic Conventions

When upgrading to the stable semantic conventions, it is recommended to do so
in the following order:

1. Upgrade `@opentelemetry/instrumentation-oracledb` to the latest version
2. Set `OTEL_SEMCONV_STABILITY_OPT_IN=database/dup`
3. Update dashboards, alerts, processors, and queries to understand the new
   `oracle.db.*` attributes and the eventual `db.namespace` change
4. Set `OTEL_SEMCONV_STABILITY_OPT_IN=database`

## Useful links

- For more information on OpenTelemetry, visit: <https://opentelemetry.io/>
- For more about OpenTelemetry JavaScript: <https://github.com/open-telemetry/opentelemetry-js>
- For help or feedback on this project, join us in
  [GitHub Discussions][discussions-url]

## License

Apache 2.0 - See [LICENSE][license-url] for more information.

[discussions-url]: https://github.com/open-telemetry/opentelemetry-js/discussions
[license-url]: https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/LICENSE
[license-image]: https://img.shields.io/badge/license-Apache_2.0-green.svg?style=flat
[npm-url]: https://www.npmjs.com/package/@opentelemetry/instrumentation-oracledb
[npm-img]: https://badge.fury.io/js/%40opentelemetry%2Finstrumentation-oracledb.svg

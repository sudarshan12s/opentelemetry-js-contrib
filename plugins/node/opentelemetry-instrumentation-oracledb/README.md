# OpenTelemetry oracledb Instrumentation for Node.js

[![NPM Published Version][npm-img]][npm-url]
[![Apache License][license-image]][license-image]

This module provides automatic instrumentation for the [`oracledb`](https://www.npmjs.com/package/oracledb) module, which may be loaded using the [`@opentelemetry/sdk-trace-node`](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-sdk-trace-node) package and is included in the [`@opentelemetry/auto-instrumentations-node`](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node) bundle.

If total installation size is not constrained, it is recommended to use the [`@opentelemetry/auto-instrumentations-node`](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node) bundle with [@opentelemetry/sdk-node](`https://www.npmjs.com/package/@opentelemetry/sdk-node`) for the most seamless instrumentation experience.

Compatible with OpenTelemetry JS API and SDK `1.0+`.

## Installation

```bash
npm install --save @opentelemetry/instrumentation-oracledb
```

## Supported Versions

- [`oracledb`](https://www.npmjs.com/package/oracledb) versions `>=6.7.0`

## Usage

OpenTelemetry oracledb Instrumentation allows the user to automatically collect trace data and export them to the backend of choice, to give observability to distributed systems when working with [oracledb](https://www.npmjs.com/package/oracledb).

To load a specific plugin (**oracledb** in this case), specify it in the registerInstrumentations's configuration

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
})
```

### oracle instrumentation Options

| Options | Type | Default | Description |
| ------- | ---- | --------| ----------- |
| `enhancedDatabaseReporting` | `boolean` | `false` | If true, additional details about the sql statement's bind values will be attached to the spans generated to represent the database operations |
| `dbStatementDump` | `boolean` | `false` | If true, ``db.statement`` will contain the sql string in the spans generated |
| `requestHook` | `OracleInstrumentationExecutionRequestHook` (function) | | Function for adding custom span attributes using information about the data for the sql statement being executed |
| `responseHook` | `OracleInstrumentationExecutionResponseHook` (function) | | Function for adding custom span attributes from the db response |
| `requireParentSpan` | `boolean` | `false` | If true, requires a parent span to create new spans |

## Useful links

- For more information on OpenTelemetry, visit: <https://opentelemetry.io/>
- For more about OpenTelemetry JavaScript: <https://github.com/open-telemetry/opentelemetry-js>
- For help or feedback on this project, join us in [GitHub Discussions][discussions-url]

## License

Apache 2.0 - See [LICENSE][license-url] for more information.

[discussions-url]: https://github.com/open-telemetry/opentelemetry-js/discussions
[license-url]: https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/LICENSE
[license-image]: https://img.shields.io/badge/license-Apache_2.0-green.svg?style=flat
[npm-url]: https://www.npmjs.com/package/@opentelemetry/instrumentation-oracledb
[npm-img]: https://badge.fury.io/js/%40opentelemetry%2Finstrumentation-oracledb.svg
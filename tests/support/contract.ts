import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/**
 * CONTRACT TESTING: responses are validated against the schemas in docs/openapi.yaml,
 * the same document that powers http://localhost:8080/api-docs/.
 * If a developer renames a field or changes a type, these assertions fail.
 */
const spec = YAML.parse(readFileSync(path.join(__dirname, '..', '..', 'docs', 'openapi.yaml'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'openapi', components: spec.components });

export function expectSchema(body: unknown, schemaName: string) {
  const validate = ajv.getSchema(`openapi#/components/schemas/${schemaName}`);
  if (!validate) throw new Error(`Unknown schema ${schemaName}`);
  const ok = validate(body);
  expect(ok, `Response does not match contract "${schemaName}":\n${ajv.errorsText(validate.errors, { separator: '\n' })}`).toBe(true);
}

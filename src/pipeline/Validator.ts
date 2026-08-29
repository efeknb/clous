// ============================================
// Clous — Validator (Data Validation)
// ============================================

import type { ValidationResult, ValidationError, ValidationRule, ValidatorFn } from '../types';

/**
 * Data validator supporting rule-based and custom validation.
 * Provides detailed error reporting with field paths and rule names.
 */
export class Validator {
  /**
   * Validate data against a set of validation rules.
   */
  static validate(data: any, rules: ValidationRule[]): ValidationResult {
    const errors: ValidationError[] = [];

    for (const rule of rules) {
      const value = Validator.getNestedValue(data, rule.field);

      for (const r of rule.rules) {
        const error = Validator.checkRule(rule.field, value, r);
        if (error) {
          errors.push(error);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate an array of items. Returns combined results.
   */
  static validateArray(data: any[], rules: ValidationRule[]): ValidationResult {
    const errors: ValidationError[] = [];

    for (let i = 0; i < data.length; i++) {
      const result = Validator.validate(data[i], rules);
      for (const error of result.errors) {
        errors.push({
          ...error,
          field: `[${i}].${error.field}`,
        });
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Create a reusable validator function from rules.
   */
  static createValidator(rules: ValidationRule[]): ValidatorFn {
    return (data: any) => Validator.validate(data, rules);
  }

  /**
   * Validate that data conforms to a simple type schema.
   */
  static validateSchema(data: any, schema: Record<string, string>): ValidationResult {
    const errors: ValidationError[] = [];

    for (const [field, expectedType] of Object.entries(schema)) {
      const value = Validator.getNestedValue(data, field);
      const actualType = Array.isArray(value) ? 'array' : typeof value;

      if (value === undefined) {
        errors.push({
          field,
          message: `Field "${field}" is missing`,
          rule: 'schema',
        });
      } else if (actualType !== expectedType) {
        errors.push({
          field,
          message: `Field "${field}" expected type "${expectedType}", got "${actualType}"`,
          value,
          rule: 'schema',
        });
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ── Private ──────────────────────────────────

  private static checkRule(
    field: string,
    value: any,
    rule: ValidationRule['rules'][0],
  ): ValidationError | null {
    switch (rule.type) {
      case 'required':
        if (value === undefined || value === null || value === '') {
          return {
            field,
            message: rule.message || `Field "${field}" is required`,
            value,
            rule: 'required',
          };
        }
        break;

      case 'type': {
        const expectedType = rule.value as string;
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (value !== undefined && value !== null && actualType !== expectedType) {
          return {
            field,
            message: rule.message || `Field "${field}" must be of type "${expectedType}"`,
            value,
            rule: 'type',
          };
        }
        break;
      }

      case 'min':
        if (typeof value === 'number' && value < (rule.value as number)) {
          return {
            field,
            message: rule.message || `Field "${field}" must be at least ${rule.value}`,
            value,
            rule: 'min',
          };
        }
        if (typeof value === 'string' && value.length < (rule.value as number)) {
          return {
            field,
            message: rule.message || `Field "${field}" must be at least ${rule.value} characters`,
            value,
            rule: 'min',
          };
        }
        if (Array.isArray(value) && value.length < (rule.value as number)) {
          return {
            field,
            message: rule.message || `Field "${field}" must have at least ${rule.value} items`,
            value,
            rule: 'min',
          };
        }
        break;

      case 'max':
        if (typeof value === 'number' && value > (rule.value as number)) {
          return {
            field,
            message: rule.message || `Field "${field}" must be at most ${rule.value}`,
            value,
            rule: 'max',
          };
        }
        if (typeof value === 'string' && value.length > (rule.value as number)) {
          return {
            field,
            message: rule.message || `Field "${field}" must be at most ${rule.value} characters`,
            value,
            rule: 'max',
          };
        }
        if (Array.isArray(value) && value.length > (rule.value as number)) {
          return {
            field,
            message: rule.message || `Field "${field}" must have at most ${rule.value} items`,
            value,
            rule: 'max',
          };
        }
        break;

      case 'pattern': {
        const pattern = rule.value instanceof RegExp ? rule.value : new RegExp(rule.value as string);
        if (typeof value === 'string' && !pattern.test(value)) {
          return {
            field,
            message: rule.message || `Field "${field}" does not match required pattern`,
            value,
            rule: 'pattern',
          };
        }
        break;
      }

      case 'custom':
        if (rule.validator && !rule.validator(value)) {
          return {
            field,
            message: rule.message || `Field "${field}" failed custom validation`,
            value,
            rule: 'custom',
          };
        }
        break;
    }

    return null;
  }

  /**
   * Get a nested value from an object using dot notation.
   */
  private static getNestedValue(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current === undefined || current === null) return undefined;
      current = current[key];
    }
    return current;
  }
}

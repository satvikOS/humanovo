/**
 * services/ barrel — single import path for every backend wrapper.
 *
 * Prefer `import { api, apiClient } from '../services'` over the
 * individual files so refactors + path-alias changes stay ergonomic.
 */

export { default as api } from './api'
export { apiClient } from './api'
export * from './knowledge'

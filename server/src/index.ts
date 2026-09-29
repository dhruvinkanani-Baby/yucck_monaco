import { env } from './config/env.js'

console.log(
  `[interncert] environment valid (${env.NODE_ENV}), port ${env.PORT}`,
)

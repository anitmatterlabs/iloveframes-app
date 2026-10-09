/// <reference types="vite/client" />
import type { IlfApi } from '../../preload/index'
declare global {
  interface Window { ilf: IlfApi }
}
declare module 'mp4box'
export {}

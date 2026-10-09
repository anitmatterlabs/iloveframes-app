import { fileName } from '../../../shared/naming'
export { wordPair, projectName, fileName, stamp } from '../../../shared/naming'

/** File name for one-off exports (screenshots): includes seconds so repeats never clash. */
export const uniqueName = (base: string, _kind: 'file' = 'file') => fileName(base, new Date(), true)
